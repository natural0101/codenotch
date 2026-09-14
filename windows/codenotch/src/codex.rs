//! Codex usage adapter. Reads ~/.codex and sibling .codex-* profiles without
//! modifying credentials. Live limits and backoff are cached per account identity.
//! Rollout helpers remain available for activity/doctor, but historical rollout
//! limits are not assigned to accounts because the logs do not bind their identity.

use crate::usage::{LimitWindow, UsageSnapshot};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
const POLL_SECS: u64 = 300; // Codex has no session state to key off, so a fixed 5 min (upstream cadence; a tray refresh interrupts it)
const TAIL_BYTES: u64 = 256 * 1024;
const ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";
const BACKOFF_MIN_SECS: u64 = 60; // wait at least this long after a 429; Retry-After only raises it
static REFRESH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Only public metadata and usage readings are exposed. Tokens never enter this state.
#[derive(Clone, Serialize)]
pub struct CodexAccount {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    /// Matches the identity in ~/.codex; does not describe a running process.
    pub active: bool,
    pub profile_path: String,
    pub snapshot: UsageSnapshot,
}
#[derive(Clone, Serialize, Deserialize)]
struct CachedAccount {
    // Account ID plus user subject, never a token. Both must match before reuse.
    identity: String,
    snapshot: UsageSnapshot,
}
static ACCOUNTS: Mutex<Vec<CodexAccount>> = Mutex::new(Vec::new());
pub fn get_accounts() -> Vec<CodexAccount> {
    ACCOUNTS.lock().unwrap().clone()
}
pub fn request_refresh() {
    REFRESH.store(true, std::sync::atomic::Ordering::Relaxed);
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
fn codex_home() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex"))
}
fn store_path() -> PathBuf {
    crate::config::config_path().with_file_name("codex.json")
}
fn accounts_store_path() -> PathBuf {
    store_path().with_file_name("codex-accounts.json")
}
fn load_cache() -> HashMap<String, CachedAccount> {
    std::fs::read_to_string(accounts_store_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn cached_for(
    cache: &HashMap<String, CachedAccount>,
    _path: &str,
    identity: &str,
) -> UsageSnapshot {
    // A renamed profile/default alias must not bypass the identity's retry deadline.
    let matching: Vec<_> = cache.values().filter(|c| c.identity == identity).collect();
    let mut snapshot = matching
        .iter()
        .filter(|c| !c.snapshot.windows.is_empty())
        .max_by_key(|c| c.snapshot.fetched_at)
        .map(|c| c.snapshot.clone())
        .unwrap_or_else(|| UsageSnapshot {
            status: "none".into(),
            note: "Waiting for current Codex limits".into(),
            ..Default::default()
        });
    snapshot.backoff_until = matching
        .iter()
        .map(|c| c.snapshot.backoff_until)
        .max()
        .unwrap_or(0);
    if !snapshot.windows.is_empty() {
        snapshot.status = "stale".into();
    }
    snapshot
}
pub fn load_persisted() -> UsageSnapshot {
    let Some(home) = codex_home() else {
        return UsageSnapshot::default();
    };
    let Some(cred) = load_credential_at(&home) else {
        return UsageSnapshot::default();
    };
    cached_for(&load_cache(), &home.to_string_lossy(), &cred.identity)
}
fn persist_cache(cache: &HashMap<String, CachedAccount>) {
    if let Ok(t) = serde_json::to_string_pretty(cache) {
        let path = accounts_store_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, t);
    }
}
/// Bounded discovery: immediate home children named .codex or .codex-* with auth.json.
fn discover_profiles(home: &Path) -> Vec<PathBuf> {
    let mut profiles: Vec<_> = list_dirs(home)
        .into_iter()
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            (name == ".codex" || (name.starts_with(".codex-") && name.len() > 7))
                && p.join("auth.json").is_file()
        })
        .collect();
    profiles.sort_by_key(|p| (p.file_name().unwrap_or_default() != ".codex", p.clone()));
    profiles
}
// ---------------- Locating the executable ----------------
/// Candidates in order: the native exe inside the global npm package (cleanest — no cmd/node
/// wrapper) → ~/.codex/bin → codex.exe / codex.cmd on PATH.
pub fn find_executable() -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Some(appdata) = dirs::config_dir() {
        let pkg = appdata
            .join("npm")
            .join("node_modules")
            .join("@openai")
            .join("codex");
        if let Ok(rd) = std::fs::read_dir(pkg.join("bin")) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if n.starts_with("codex-") && n.contains("windows") && n.ends_with(".exe") {
                    cands.push(e.path());
                }
            }
        }
        if let Ok(rd) = std::fs::read_dir(pkg.join("vendor")) {
            // Newer packages keep the native exe at vendor/<triple>/codex/codex.exe
            for e in rd.flatten() {
                let p = e.path().join("codex").join("codex.exe");
                if p.exists() {
                    cands.push(p);
                }
            }
        }
        cands.push(appdata.join("npm").join("codex.cmd"));
    }
    if let Some(h) = codex_home() {
        cands.push(h.join("bin").join("codex.exe"));
        cands.push(h.join("bin").join("codex"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            cands.push(dir.join("codex.exe"));
            cands.push(dir.join("codex.cmd"));
        }
    }
    cands.into_iter().find(|p| p.is_file())
}
// ---------------- Live: the usage endpoint ----------------
fn auth_path() -> Option<PathBuf> {
    codex_home().map(|h| h.join("auth.json"))
}
struct Credential {
    access_token: String,
    identity: String,
    email: Option<String>,
    account_id: String,
    /// chatgpt_plan_type from the id_token (pro / plus / free…), used only as a label
    plan: Option<String>,
    /// The access_token's exp has passed: the request is still sent (the server decides); this only changes the 401 wording
    expired: bool,
}
/// Second JWT segment (base64url) → claims. Used only for labels and a local expiry hint; nothing is verified here — that is the server's job
fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    let part = token.split('.').nth(1)?;
    let raw = crate::antigravity::b64_decode(part)?;
    serde_json::from_slice(&raw).ok()
}
/// Reads Codex's sign-in state; a missing file or missing field both mean "not signed in"
fn load_credential() -> Option<Credential> {
    load_credential_at(&codex_home()?)
}
fn load_credential_at(home: &Path) -> Option<Credential> {
    let text = std::fs::read_to_string(home.join("auth.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let tokens = v.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.trim().to_string();
    let account_id = tokens.get("account_id")?.as_str()?.trim().to_string();
    if access_token.is_empty() || account_id.is_empty() {
        return None;
    }
    let expired = jwt_claims(&access_token)
        .and_then(|c| c.get("exp").and_then(|x| x.as_f64()))
        .map(|exp| exp * 1000.0 <= now_ms() as f64)
        .unwrap_or(false);
    let plan = tokens
        .get("id_token")
        .and_then(|x| x.as_str())
        .and_then(jwt_claims)
        .and_then(|c| {
            c.get("https://api.openai.com/auth")?
                .get("chatgpt_plan_type")?
                .as_str()
                .map(String::from)
        });
    let claims = tokens
        .get("id_token")
        .and_then(|x| x.as_str())
        .and_then(jwt_claims);
    let email = claims
        .as_ref()
        .and_then(|c| c.get("email"))
        .and_then(|x| x.as_str())
        .map(String::from);
    let subject = claims
        .as_ref()
        .and_then(|c| c.get("sub"))
        .and_then(|x| x.as_str())
        .map(String::from)
        .or_else(|| {
            jwt_claims(&access_token)
                .and_then(|c| c.get("sub").and_then(|x| x.as_str()).map(String::from))
        })
        .or_else(|| email.clone())
        .unwrap_or_default();
    let identity = serde_json::to_string(&(&account_id, subject)).ok()?;
    Some(Credential {
        access_token,
        account_id,
        identity,
        email,
        plan,
        expired,
    })
}
enum LiveErr {
    NeedsAuth,
    /// Suggested wait in seconds (BACKOFF_MIN_SECS already applied)
    RateLimited(u64),
    Other(String),
}
fn fetch_usage(cred: &Credential) -> Result<serde_json::Value, LiveErr> {
    let resp = ureq::get(ENDPOINT)
        .set("Authorization", &format!("Bearer {}", cred.access_token))
        .set("ChatGPT-Account-Id", &cred.account_id)
        .set("Accept", "application/json")
        .set("Cache-Control", "no-cache, no-store")
        .set(
            "User-Agent",
            concat!("codenotch/", env!("CARGO_PKG_VERSION"), " (Windows)"),
        )
        .timeout(Duration::from_secs(15))
        .call();
    match resp {
        Ok(r) => r
            .into_json()
            .map_err(|e| LiveErr::Other(format!("parse: {e}"))),
        Err(ureq::Error::Status(code @ (401 | 403), _)) => {
            // Do not log response bodies: upstream errors may contain account data.
            crate::applog(&format!("codex: usage endpoint HTTP {code}"));
            Err(LiveErr::NeedsAuth)
        }
        Err(ureq::Error::Status(429, r)) => {
            let ra = r
                .header("retry-after")
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(0);
            Err(LiveErr::RateLimited(ra.max(BACKOFF_MIN_SECS)))
        }
        Err(ureq::Error::Status(code, _)) => Err(LiveErr::Other(format!("HTTP {code}"))),
        Err(e) => Err(LiveErr::Other(format!("{e}"))),
    }
}
/// Upstream's label rule: Codex names windows only by length, and "5h limit" says more than "primary"
fn label_for(window_minutes: Option<f64>, id: &str) -> String {
    match window_minutes {
        Some(m) if m > 0.0 => {
            if m < 60.0 {
                format!("{}m limit", m as i64)
            } else if m < 60.0 * 24.0 {
                format!("{}h limit", (m / 60.0) as i64)
            } else {
                let days = (m / (60.0 * 24.0)).round() as i64;
                match days {
                    7 => "Weekly limit".into(),
                    30 => "Monthly limit".into(),
                    d => format!("{d}d limit"),
                }
            }
        }
        _ => {
            if id == "primary" {
                "Current session".into()
            } else {
                "Longer window".into()
            }
        }
    }
}
fn num(v: Option<&serde_json::Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}
/// Seconds → ms. Negative / non-finite values are treated as missing so a
/// garbage extra cannot wrap `now + ms` (debug overflow panics).
fn secs_to_ms(s: f64) -> Option<u64> {
    if !s.is_finite() || s < 0.0 {
        None
    } else {
        Some((s * 1000.0) as u64)
    }
}
fn reset_at_ms(w: &serde_json::Value, now: u64, epoch_key: &str, delay_key: &str) -> Option<u64> {
    num(w.get(epoch_key)).and_then(secs_to_ms).or_else(|| {
        num(w.get(delay_key))
            .and_then(secs_to_ms)
            .map(|ms| now.saturating_add(ms))
    })
}
/// Skip a window with no `used_percent`. Extra ids still pass primary/secondary to `label_for`.
fn window_from(
    w: &serde_json::Value,
    id: &str,
    fallback: &str,
    now: u64,
    group: Option<&str>,
) -> Option<LimitWindow> {
    if !w.is_object() {
        return None;
    }
    let pct = num(w.get("used_percent"))?;
    Some(LimitWindow {
        id: id.into(),
        label: label_for(
            num(w.get("limit_window_seconds")).map(|s| s / 60.0),
            fallback,
        ),
        used: (pct / 100.0).clamp(0.0, 1.0),
        resets_at: reset_at_ms(w, now, "reset_at", "reset_after_seconds"),
        group: group.map(str::to_string),
        ..Default::default()
    })
}
fn names_spark(extra: &serde_json::Value) -> bool {
    if !extra.is_object() {
        return false;
    }
    ["limit_name", "metered_feature"].iter().any(|key| {
        extra
            .get(*key)
            .and_then(|x| x.as_str())
            .is_some_and(|s| s.to_lowercase().contains("spark"))
    })
}
/// Spark / code review sit after the main pair so `windows.first` stays primary.
/// The group is what the hover card uses to box them; omitting it leaves them
/// as extra ungrouped bars under the main windows.
fn append_extra(
    rl: Option<&serde_json::Value>,
    primary_id: &str,
    secondary_id: &str,
    group: &str,
    now: u64,
    out: &mut Vec<LimitWindow>,
) {
    let Some(rl) = rl.filter(|x| x.is_object()) else {
        return;
    };
    if let Some(w) = rl
        .get("primary_window")
        .and_then(|x| window_from(x, primary_id, "primary", now, Some(group)))
    {
        push_unique(out, w);
    }
    if let Some(w) = rl
        .get("secondary_window")
        .and_then(|x| window_from(x, secondary_id, "secondary", now, Some(group)))
    {
        push_unique(out, w);
    }
}
fn push_unique(out: &mut Vec<LimitWindow>, window: LimitWindow) {
    if out.iter().any(|w| w.id == window.id) {
        return;
    }
    out.push(window);
}
/// Usage reply → windows. Primary and secondary feed the ring; Spark
/// (`additional_rate_limits`) and Code review (`code_review_rate_limit`) belong
/// on the hover card, not as extra rings. The window id records which field it
/// came from and the label is derived from the length — the primary window is
/// not always five hours (a free plan has shown 30 days), and recognising only
/// fixed lengths would drop a window that is genuinely in use.
fn windows_from_usage(v: &serde_json::Value) -> Vec<LimitWindow> {
    let now = now_ms();
    let mut out = Vec::new();
    for (id, key) in [
        ("primary", "primary_window"),
        ("secondary", "secondary_window"),
    ] {
        if let Some(w) = v
            .pointer(&format!("/rate_limit/{key}"))
            .and_then(|x| window_from(x, id, id, now, None))
        {
            out.push(w);
        }
    }
    // A non-array (null, object, string) is the same as omitting the field —
    // one junk extra must not discard the main pair or a later Spark row.
    if let Some(extras) = v.get("additional_rate_limits").and_then(|x| x.as_array()) {
        for extra in extras {
            if !names_spark(extra) {
                continue;
            }
            append_extra(
                extra.get("rate_limit"),
                "spark",
                "spark-secondary",
                "Spark",
                now,
                &mut out,
            );
        }
    }
    append_extra(
        v.get("code_review_rate_limit"),
        "code-review",
        "code-review-secondary",
        "Code review",
        now,
        &mut out,
    );
    out
}
// ---------------- Fallback: the rollout snapshot ----------------
/// The most recently modified rollout: dated directories newest-first, looking only at the three most recent days that have files
pub fn newest_rollout() -> Option<PathBuf> {
    let root = codex_home()?.join("sessions");
    let mut days: Vec<PathBuf> = Vec::new();
    let mut years = list_dirs(&root);
    years.sort_by(|a, b| b.cmp(a));
    'outer: for y in years {
        let mut months = list_dirs(&y);
        months.sort_by(|a, b| b.cmp(a));
        for m in months {
            let mut ds = list_dirs(&m);
            ds.sort_by(|a, b| b.cmp(a));
            for d in ds {
                days.push(d);
                if days.len() >= 3 {
                    break 'outer;
                }
            }
        }
    }
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for d in days {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                let name = p
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
                    continue;
                }
                let Ok(md) = e.metadata() else { continue };
                let Ok(mt) = md.modified() else { continue };
                if best.as_ref().map(|(t, _)| mt > *t).unwrap_or(true) {
                    best = Some((mt, p));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}
fn list_dirs(p: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(p)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}
pub fn tail_text(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES)));
    let mut raw = Vec::new();
    f.read_to_end(&mut raw).ok()?;
    Some(String::from_utf8_lossy(&raw).into_owned())
}
/// The last rate_limits snapshot at the tail of a rollout → (windows, recorded-at ms, plan)
pub fn snapshot_from_rollout(
    text: &str,
) -> Option<(Vec<LimitWindow>, Option<u64>, Option<String>)> {
    for line in text.lines().rev().filter(|l| l.contains("rate_limits")) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        // rate_limits may sit at the top level or under payload
        let rl = v
            .get("rate_limits")
            .or_else(|| v.pointer("/payload/rate_limits"))
            .filter(|x| x.is_object());
        let Some(rl) = rl else { continue };
        let recorded = v
            .get("timestamp")
            .and_then(|x| x.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis().max(0) as u64);
        let now = now_ms();
        let mut out = Vec::new();
        for id in ["primary", "secondary"] {
            let Some(w) = rl.get(id).filter(|x| x.is_object()) else {
                continue;
            };
            let Some(pct) = num(w.get("used_percent")) else {
                continue;
            };
            out.push(LimitWindow {
                id: id.into(),
                label: label_for(num(w.get("window_minutes")), id),
                used: (pct / 100.0).clamp(0.0, 1.0),
                resets_at: reset_at_ms(w, now, "resets_at", "resets_in_seconds"),
                ..Default::default()
            });
        }
        if out.is_empty() {
            continue;
        }
        let plan = rl
            .get("plan_type")
            .and_then(|x| x.as_str())
            .map(String::from);
        return Some((out, recorded, plan));
    }
    None
}
// ---------------- Putting it together ----------------
/// Is Codex present on this machine (CLI installed, signed in, or has had sessions)? If not, no cell is shown
fn profiles_present(home: &Path) -> bool {
    !discover_profiles(home).is_empty() || home.join(".codex").join("sessions").is_dir()
}

pub fn present() -> bool {
    find_executable().is_some()
        || dirs::home_dir()
            .map(|h| profiles_present(&h))
            .unwrap_or(false)
}
fn stale_failure(mut snap: UsageSnapshot, status: &str, note: String, until: u64) -> UsageSnapshot {
    snap.status = if snap.windows.is_empty() {
        status
    } else {
        "stale"
    }
    .into();
    snap.note = note;
    snap.backoff_until = until;
    snap
}
fn read_account(cred: &Credential, previous: UsageSnapshot, now: u64) -> UsageSnapshot {
    // This check applies to manual refresh too, separately for every identity.
    if previous.backoff_until > now {
        let until = previous.backoff_until;
        return stale_failure(
            previous,
            "backoff",
            "Rate limited — waiting before retry".into(),
            until,
        );
    }
    apply_live_result(cred, previous, fetch_usage(cred), now)
}
fn apply_live_result(
    cred: &Credential,
    previous: UsageSnapshot,
    result: Result<serde_json::Value, LiveErr>,
    now: u64,
) -> UsageSnapshot {
    match result {
        Ok(v) => {
            let windows = windows_from_usage(&v);
            if windows.is_empty() {
                return stale_failure(
                    previous,
                    "none",
                    "Codex reported no usage windows".into(),
                    0,
                );
            }
            let plan = v
                .get("plan_type")
                .and_then(|x| x.as_str())
                .map(String::from)
                .or_else(|| cred.plan.clone());
            UsageSnapshot {
                status: "ok".into(),
                windows,
                fetched_at: now,
                note: plan
                    .map(|p| format!("{} · via Codex", cap(&p)))
                    .unwrap_or_default(),
                ..Default::default()
            }
        }
        Err(LiveErr::NeedsAuth) => stale_failure(
            previous,
            "needsAuth",
            if cred.expired {
                "Codex sign-in expired — open Codex to refresh it"
            } else {
                "Codex rejected its sign-in — sign in to Codex again"
            }
            .into(),
            0,
        ),
        Err(LiveErr::RateLimited(secs)) => stale_failure(
            previous,
            "backoff",
            "Rate limited — waiting before retry".into(),
            now.saturating_add(secs.saturating_mul(1000)),
        ),
        Err(LiveErr::Other(_)) => stale_failure(
            previous,
            "error",
            "Live read failed — retrying later".into(),
            0,
        ),
    }
}
fn poll_accounts(
    cache: &mut HashMap<String, CachedAccount>,
    live: bool,
) -> (Vec<CodexAccount>, UsageSnapshot) {
    let Some(home) = dirs::home_dir() else {
        return (Vec::new(), UsageSnapshot::default());
    };
    let default_home = home.join(".codex");
    let default_identity = load_credential_at(&default_home).map(|c| c.identity);
    let mut accounts = Vec::new();
    let mut next_cache = HashMap::new();
    // Identical accounts in several profiles are polled once per cycle.
    let mut readings: HashMap<String, UsageSnapshot> = HashMap::new();
    let mut default_snap = UsageSnapshot {
        status: if present() { "none" } else { "absent" }.into(),
        note: "Sign in to Codex to read current account limits".into(),
        ..Default::default()
    };
    for path in discover_profiles(&home) {
        let path_text = path.to_string_lossy().into_owned();
        let label = if path == default_home {
            "Default".into()
        } else {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .trim_start_matches(".codex-")
                .to_string()
        };
        let (email, active, snapshot) = if let Some(cred) = load_credential_at(&path) {
            let previous = cached_for(cache, &path_text, &cred.identity);
            let snapshot = readings
                .entry(cred.identity.clone())
                .or_insert_with(|| {
                    if live {
                        read_account(&cred, previous, now_ms())
                    } else {
                        previous
                    }
                })
                .clone();
            // A concurrent sign-in must not attach the old response to the new profile.
            if load_credential_at(&path).map(|c| c.identity) != Some(cred.identity.clone()) {
                continue;
            }
            next_cache.insert(
                path_text.clone(),
                CachedAccount {
                    identity: cred.identity.clone(),
                    snapshot: snapshot.clone(),
                },
            );
            (
                cred.email,
                default_identity.as_ref() == Some(&cred.identity),
                snapshot,
            )
        } else {
            (
                None,
                false,
                UsageSnapshot {
                    status: "needsAuth".into(),
                    note: "No usable Codex sign-in in this profile".into(),
                    ..Default::default()
                },
            )
        };
        if path == default_home {
            default_snap = snapshot.clone();
        }
        accounts.push(CodexAccount {
            id: path_text.clone(),
            label,
            email,
            active,
            profile_path: path_text,
            snapshot,
        });
    }
    *cache = next_cache;
    (accounts, default_snap)
}
fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}
fn broadcast(app: &AppHandle, snap: UsageSnapshot) {
    let st = app.state::<AppState>();
    *st.codex.lock().unwrap() = snap.clone();
    let _ = app.emit("codex", &snap);
}
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut cache = load_cache();
        // Publish validated cache before any potentially slow network request.
        let (accounts, snap) = poll_accounts(&mut cache, false);
        *ACCOUNTS.lock().unwrap() = accounts.clone();
        let _ = app.emit("codex_accounts", &accounts);
        broadcast(&app, snap);
        loop {
            let (accounts, snap) = poll_accounts(&mut cache, true);
            *ACCOUNTS.lock().unwrap() = accounts.clone();
            persist_cache(&cache);
            let _ = app.emit("codex_accounts", &accounts);
            broadcast(&app, snap);
            for _ in 0..POLL_SECS {
                if REFRESH.swap(false, std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    });
}
/// For doctor: contains no secrets
pub fn probe() -> String {
    let auth = match load_credential() {
        Some(c) => format!(
            "auth.json usable{}{}",
            if c.expired {
                " (access_token expired)"
            } else {
                ""
            },
            c.plan.map(|p| format!(", plan={p}")).unwrap_or_default()
        ),
        None if auth_path().map(|p| p.is_file()).unwrap_or(false) => {
            "auth.json present but has no token".to_string()
        }
        None => "auth.json not found".to_string(),
    };
    let exe = find_executable();
    let roll = newest_rollout();
    let age = roll
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| format!("{} min ago", d.as_secs() / 60))
        .unwrap_or_else(|| "?".into());
    format!(
        "Codex: {auth} | executable {} | newest rollout {} (modified {})",
        exe.map(|p| p.display().to_string())
            .unwrap_or_else(|| "not found".into()),
        roll.map(|p| p.display().to_string())
            .unwrap_or_else(|| "none".into()),
        age
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn credential(identity: &str) -> Credential {
        Credential {
            access_token: "unused-test-token".into(),
            account_id: identity.into(),
            identity: identity.into(),
            email: None,
            plan: None,
            expired: false,
        }
    }
    fn cached_snapshot() -> UsageSnapshot {
        UsageSnapshot {
            status: "ok".into(),
            fetched_at: 1234,
            windows: vec![LimitWindow {
                used: 0.42,
                ..Default::default()
            }],
            ..Default::default()
        }
    }
    #[test]
    fn identity_change_drops_previous_limits_and_backoff() {
        let mut cache = HashMap::new();
        let mut old = cached_snapshot();
        old.backoff_until = 99_000;
        cache.insert(
            "profile".into(),
            CachedAccount {
                identity: "user-a".into(),
                snapshot: old,
            },
        );
        let same = cached_for(&cache, "profile", "user-a");
        assert_eq!(same.status, "stale");
        assert_eq!(same.backoff_until, 99_000);
        let changed = cached_for(&cache, "profile", "user-b");
        assert!(changed.windows.is_empty());
        assert_eq!(changed.backoff_until, 0);
    }
    #[test]
    fn renamed_profile_reuses_only_same_identity_and_longest_backoff() {
        let mut cache = HashMap::new();
        let mut older = cached_snapshot();
        older.backoff_until = 90_000;
        let mut newer = cached_snapshot();
        newer.fetched_at = 2000;
        newer.windows[0].used = 0.8;
        newer.backoff_until = 3000;
        cache.insert(
            "old-path".into(),
            CachedAccount {
                identity: "a".into(),
                snapshot: older,
            },
        );
        cache.insert(
            "another-path".into(),
            CachedAccount {
                identity: "a".into(),
                snapshot: newer,
            },
        );
        let restored = cached_for(&cache, "new-default-path", "a");
        assert_eq!(restored.backoff_until, 90_000);
        assert_eq!(restored.fetched_at, 2000);
        assert_eq!(restored.windows[0].used, 0.8);
        assert!(cached_for(&cache, "old-path", "b").windows.is_empty());
        let serialized = serde_json::to_value(&cache).unwrap();
        let fields = serialized["old-path"].as_object().unwrap();
        assert_eq!(fields.len(), 2);
        assert!(fields.contains_key("identity") && fields.contains_key("snapshot"));
        assert!(!serialized.to_string().contains("access_token"));
    }

    #[test]
    fn network_failure_keeps_reading_timestamp_and_marks_stale() {
        let snap = apply_live_result(
            &credential("a"),
            cached_snapshot(),
            Err(LiveErr::Other("offline".into())),
            5000,
        );
        assert_eq!(snap.status, "stale");
        assert_eq!(snap.fetched_at, 1234);
        assert_eq!(snap.windows[0].used, 0.42);
        assert!(!snap.note.contains("offline"));
    }
    #[test]
    fn manual_refresh_obeys_backoff_without_network_request() {
        let limited = apply_live_result(
            &credential("a"),
            cached_snapshot(),
            Err(LiveErr::RateLimited(120)),
            5000,
        );
        assert_eq!(limited.backoff_until, 125_000);
        // The deliberately invalid token must never reach the endpoint in this branch.
        let held = read_account(&credential("a"), limited, 6000);
        assert_eq!(held.backoff_until, 125_000);
        assert_eq!(held.fetched_at, 1234);
        assert_eq!(held.windows[0].used, 0.42);
    }
    #[test]
    fn successful_read_clears_backoff_and_replaces_windows() {
        let mut previous = cached_snapshot();
        previous.backoff_until = 2000;
        let snap = apply_live_result(
            &credential("a"),
            previous,
            Ok(
                serde_json::json!({"rate_limit":{"primary_window":{"used_percent":10,"limit_window_seconds":18000}}}),
            ),
            5000,
        );
        assert_eq!(snap.status, "ok");
        assert_eq!(snap.backoff_until, 0);
        assert_eq!(snap.fetched_at, 5000);
        assert_eq!(snap.windows[0].used, 0.1);
    }
    #[test]
    fn additional_profile_alone_enables_auto_detection() {
        let root = std::env::temp_dir().join(format!(
            "codenotch-profile-only-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(root.join(".codex-work")).unwrap();
        assert!(!profiles_present(&root));
        std::fs::write(root.join(".codex-work").join("auth.json"), "{}").unwrap();
        assert!(!root.join(".codex").exists());
        assert!(profiles_present(&root));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_is_shallow_and_requires_profile_auth_file() {
        let root = std::env::temp_dir().join(format!(
            "codenotch-discovery-{}-{}",
            std::process::id(),
            now_ms()
        ));
        for name in [
            ".codex",
            ".codex-work",
            ".codex-empty",
            "other",
            "nested/.codex-hidden",
        ] {
            std::fs::create_dir_all(root.join(name)).unwrap();
            if name != ".codex-empty" {
                std::fs::write(root.join(name).join("auth.json"), "{}").unwrap();
            }
        }
        let found: Vec<_> = discover_profiles(&root)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(found, [".codex", ".codex-work"]);
        std::fs::remove_dir_all(root).unwrap();
    }
    fn windows(json: &str) -> Vec<LimitWindow> {
        windows_from_usage(&serde_json::from_str(json).unwrap())
    }
    fn ids(ws: &[LimitWindow]) -> Vec<&str> {
        ws.iter().map(|w| w.id.as_str()).collect()
    }
    fn labels(ws: &[LimitWindow]) -> Vec<&str> {
        ws.iter().map(|w| w.label.as_str()).collect()
    }
    fn groups(ws: &[LimitWindow]) -> Vec<Option<&str>> {
        ws.iter().map(|w| w.group.as_deref()).collect()
    }
    #[test]
    fn extra_spark_and_code_review_follow_primary_secondary() {
        let ws = windows(
            r#"{
            "rate_limit":{
              "primary_window":{"used_percent":25,"limit_window_seconds":18000,"reset_at":1800001000},
              "secondary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_at":1800600000}},
            "additional_rate_limits":[{"limit_name":"Spark","rate_limit":{
              "primary_window":{"used_percent":99,"limit_window_seconds":18000}}}],
            "code_review_rate_limit":{"primary_window":{"used_percent":90,"limit_window_seconds":604800}},
            "credits":{"balance":"100"},"model_usage":{"spark":99}
        }"#,
        );
        assert_eq!(ids(&ws), ["primary", "secondary", "spark", "code-review"]);
        assert_eq!(
            labels(&ws),
            ["5h limit", "Weekly limit", "5h limit", "Weekly limit"]
        );
        assert_eq!(
            groups(&ws),
            [None, None, Some("Spark"), Some("Code review")]
        );
        assert!((ws[0].used - 0.25).abs() < 1e-9);
        assert!((ws[2].used - 0.99).abs() < 1e-9);
        assert!((ws[3].used - 0.90).abs() < 1e-9);
        assert_eq!(ws[0].resets_at, Some(1_800_001_000_000));
    }
    #[test]
    fn spark_matches_limit_name_or_metered_feature_case_insensitively() {
        // "GPT-5.3-Codex-Spark" still contains the substring "Spark", so it
        // would pass a case-sensitive contains("Spark"). SPARK / spark would not.
        for (field, name) in [
            ("limit_name", "SPARK"),
            ("limit_name", "spark"),
            ("metered_feature", "GPT-5.3-Codex-SPARK"),
            ("metered_feature", "gpt-5.3-codex-spark"),
        ] {
            let ws = windows(&format!(
                r#"{{
                "rate_limit":{{"primary_window":{{"used_percent":1,"limit_window_seconds":18000}}}},
                "additional_rate_limits":[{{"{field}":"{name}","rate_limit":{{
                  "primary_window":{{"used_percent":40,"limit_window_seconds":18000}},
                  "secondary_window":{{"used_percent":5,"limit_window_seconds":604800}}}}}}]
            }}"#
            ));
            assert_eq!(
                ids(&ws),
                ["primary", "spark", "spark-secondary"],
                "{field}={name}"
            );
            assert_eq!(
                groups(&ws)[1..],
                [Some("Spark"), Some("Spark")],
                "{field}={name}"
            );
            assert_eq!(
                labels(&ws)[1..],
                ["5h limit", "Weekly limit"],
                "{field}={name}"
            );
        }
    }
    #[test]
    fn extras_alone_are_still_a_reading() {
        let ws = windows(
            r#"{"additional_rate_limits":[{"limit_name":"Spark","rate_limit":{
              "primary_window":{"used_percent":40,"limit_window_seconds":18000},
              "secondary_window":{"used_percent":70,"limit_window_seconds":604800}}}]}"#,
        );
        assert_eq!(ids(&ws), ["spark", "spark-secondary"]);
        assert_eq!(groups(&ws), [Some("Spark"), Some("Spark")]);
        assert_eq!(labels(&ws), ["5h limit", "Weekly limit"]);
        assert!((ws[0].used - 0.40).abs() < 1e-9);
        assert!((ws[1].used - 0.70).abs() < 1e-9);
    }
    #[test]
    fn non_spark_additional_limits_are_ignored() {
        let ws = windows(
            r#"{
            "rate_limit":{"primary_window":{"used_percent":1,"limit_window_seconds":18000}},
            "additional_rate_limits":[{"limit_name":"codex_other","metered_feature":"codex_other","rate_limit":{
              "primary_window":{"used_percent":70,"limit_window_seconds":3600}}}]
        }"#,
        );
        assert_eq!(ids(&ws), ["primary"]);
    }
    #[test]
    fn empty_additional_rate_limits_leave_the_main_windows() {
        let ws = windows(
            r#"{
            "rate_limit":{
              "primary_window":{"used_percent":25,"limit_window_seconds":18000},
              "secondary_window":{"used_percent":10,"limit_window_seconds":604800}},
            "additional_rate_limits":[]
        }"#,
        );
        assert_eq!(ids(&ws), ["primary", "secondary"]);
        assert_eq!(groups(&ws), [None, None]);
    }
    #[test]
    fn extras_without_used_percent_are_skipped() {
        let ws = windows(
            r#"{
            "rate_limit":{"primary_window":{"used_percent":1,"limit_window_seconds":18000}},
            "additional_rate_limits":[{"limit_name":"Spark","rate_limit":{
              "primary_window":{"used_percent":null,"limit_window_seconds":18000},
              "secondary_window":{"used_percent":12,"limit_window_seconds":604800}}}],
            "code_review_rate_limit":{
              "primary_window":{"limit_window_seconds":604800},
              "secondary_window":{"used_percent":8,"limit_window_seconds":18000}}
        }"#,
        );
        assert_eq!(
            ids(&ws),
            ["primary", "spark-secondary", "code-review-secondary"]
        );
        assert_eq!(groups(&ws)[1..], [Some("Spark"), Some("Code review")]);
        assert_eq!(ws[1].label, "Weekly limit");
        assert_eq!(ws[2].label, "5h limit");
    }
    #[test]
    fn malformed_extras_do_not_drop_the_main_windows() {
        let ws = windows(
            r#"{
            "rate_limit":{"primary_window":{"used_percent":25,"limit_window_seconds":18000}},
            "additional_rate_limits":[
              "nope",
              42,
              null,
              {"limit_name":"Spark"},
              {"limit_name":"Spark","rate_limit":"nope"},
              {"limit_name":"Spark","rate_limit":{"primary_window":{
                "used_percent":40,"limit_window_seconds":18000,"reset_after_seconds":1e20}}},
              {"limit_name":"Spark","rate_limit":{"primary_window":{
                "used_percent":15,"limit_window_seconds":18000}}}
            ],
            "code_review_rate_limit":"nope"
        }"#,
        );
        assert_eq!(ids(&ws), ["primary", "spark"]);
        assert_eq!(groups(&ws), [None, Some("Spark")]);
        assert!((ws[1].used - 0.40).abs() < 1e-9);
        assert!(ws[1].resets_at.is_some());
    }
    #[test]
    fn two_spark_extras_do_not_duplicate_window_ids() {
        let ws = windows(
            r#"{
            "rate_limit":{
              "primary_window":{"used_percent":25,"limit_window_seconds":18000},
              "secondary_window":{"used_percent":10,"limit_window_seconds":604800}},
            "additional_rate_limits":[
              {"limit_name":"Spark","rate_limit":{
                "primary_window":{"used_percent":40,"limit_window_seconds":18000}}},
              {"limit_name":"GPT-5.3-Codex-Spark","metered_feature":"spark","rate_limit":{
                "primary_window":{"used_percent":99,"limit_window_seconds":18000},
                "secondary_window":{"used_percent":12,"limit_window_seconds":604800}}}
            ]
        }"#,
        );
        assert_eq!(
            ids(&ws),
            ["primary", "secondary", "spark", "spark-secondary"]
        );
        assert_eq!(groups(&ws), [None, None, Some("Spark"), Some("Spark")]);
        assert_eq!(
            labels(&ws),
            ["5h limit", "Weekly limit", "5h limit", "Weekly limit"]
        );
        assert!((ws[2].used - 0.40).abs() < 1e-9);
        assert!((ws[3].used - 0.12).abs() < 1e-9);
    }
    #[test]
    fn a_non_array_additional_rate_limits_is_ignored() {
        for extras in [
            r#"{"x":{"limit_name":"Spark","rate_limit":{"primary_window":{"used_percent":9,"limit_window_seconds":18000}}}}"#,
            r#""nope""#,
            "null",
        ] {
            let ws = windows(&format!(
                r#"{{"rate_limit":{{"primary_window":{{"used_percent":1,"limit_window_seconds":18000}}}},"additional_rate_limits":{extras}}}"#
            ));
            assert_eq!(ids(&ws), ["primary"], "{extras}");
        }
    }
    #[test]
    fn a_monthly_primary_window_is_not_dropped() {
        let ws = windows(
            r#"{"rate_limit":{"primary_window":{"used_percent":16,"limit_window_seconds":2592000,
            "reset_after_seconds":1838382,"reset_at":1790585722},"secondary_window":null},
             "plan_type":"free"}"#,
        );
        assert_eq!(ids(&ws), ["primary"]);
        assert_eq!(ws[0].label, "Monthly limit");
        assert!((ws[0].used - 0.16).abs() < 1e-4);
    }
}
