use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// How small the notch may be drawn, as a multiple of its designed size. Below roughly 0.4 the
/// rings stop being readable at 100 % display scaling.
pub const SCALE_MIN: f64 = 0.40;
pub const SCALE_MAX: f64 = 1.00;

/// One half of the tray icon, or one ring on the notch: which provider. It shows that provider's
/// ring, so the tray and the notch can never disagree. (A `window` key from older builds is ignored.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TraySlot {
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DrawerPreferences {
    pub show_todos: bool,
    pub show_services: bool,
    pub show_memory: bool,
    pub show_header: bool,
    pub show_plan: bool,
    pub show_reset: bool,
    pub show_updated: bool,
    pub show_extras: bool,
    pub show_actions: bool,
    pub show_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub drawer_preferences: DrawerPreferences,
    #[serde(default = "default_port")]
    pub port: u16,
    /// "auto" | "zh" | "en" | "ja" | "ko" | "ru"
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(default)]
    pub bar_x: Option<i32>,
    #[serde(default)]
    pub bar_y: Option<i32>,
    /// Logical width of the bar (wheel-adjustable, 220-520); None = default 360
    #[serde(default)]
    pub bar_w: Option<u32>,
    /// Allow dragging + wheel resizing (tray toggle, off by default to prevent accidental drags)
    #[serde(default)]
    pub drag_enabled: bool,
    /// Vertical position of the notch: the window centre as a fraction of the primary monitor's height (0 = top, 1 = bottom), default 0.5; saved after a drag
    #[serde(default = "default_notch_y")]
    pub notch_y: f64,
    /// Legacy Auto/Show/Hide choices also control whether provider workers are started.
    #[serde(default)]
    pub providers: std::collections::BTreeMap<String, ProviderMode>,
    /// Notch size as a multiple of the designed size (slider at the foot of the hover card).
    /// Only the pill is scaled — the hover card keeps its size, so the slider does not move
    /// while it is being dragged.
    #[serde(default = "default_scale")]
    pub scale: f64,
    /// What the tray icon draws: "off" (the plain mark, the previous behaviour and the default),
    /// "numbers" (up to two readings as digits) or "bars" (a column per reading).
    #[serde(default = "default_tray_mode")]
    pub tray_mode: String,
    /// Which providers the tray icon covers, in the order they are drawn. Ids match the page:
    /// "claude", "codex", "cursor", "gemini". Superseded by `tray_slots`; kept so an existing
    /// config still upgrades cleanly, and migrated in `load()`.
    #[serde(default = "default_tray_providers")]
    pub tray_providers: Vec<String>,
    /// What each part of the tray icon shows, in drawing order: the first entry is the top half of
    /// the digit layout, the second the bottom half, and the bar layout uses them all in order.
    #[serde(default)]
    pub tray_slots: Vec<TraySlot>,
    /// Which providers the notch itself shows, in order. Empty means every provider that has
    /// something to report — the original behaviour, and the default. Superseded by `notch_slots`,
    /// kept so an existing config migrates cleanly.
    #[serde(default)]
    pub notch_providers: Vec<String>,
    /// Which providers get a ring on the notch, in order. An empty list means every provider.
    #[serde(default)]
    pub notch_slots: Vec<TraySlot>,
    /// Antigravity's lane on the ring, as the Mac app's "Notch reads": "automatic", "5h" or "weekly"
    #[serde(default = "default_antigravity_limit")]
    pub antigravity_limit: String,
    /// The model family that choice looks at, as the Mac app's "Model data": "gemini" or "3p"
    #[serde(default = "default_antigravity_model")]
    pub antigravity_model: String,
    /// false = the pill is kept off the screen edge entirely; the tray icon is then the only way in
    #[serde(default = "yes")]
    pub notch_visible: bool,
    /// false = the tray icon is hidden. Refused while the notch is also hidden, because that would
    /// leave the app running with no way to reach it.
    #[serde(default = "yes")]
    pub tray_visible: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProviderMode {
    #[default]
    Auto,
    Show,
    Hide,
}

impl Config {
    pub fn provider_mode(&self, id: &str) -> ProviderMode {
        self.providers.get(id).copied().unwrap_or_default()
    }
}

pub fn provider_enabled(id: &str) -> bool {
    enabled_when(load().provider_mode(id), || detected(id))
}

fn enabled_when(mode: ProviderMode, detect: impl FnOnce() -> bool) -> bool {
    match mode {
        ProviderMode::Hide => false,
        ProviderMode::Show => true,
        ProviderMode::Auto => detect(),
    }
}

fn detected(id: &str) -> bool {
    if !crate::glyphs::app_candidates(id).is_empty() { return true; }
    match id {
        "codex" => crate::codex::present(),
        "claude" => dirs::home_dir().map(|h| [".credentials.json", "credentials.json"].iter()
            .any(|n| h.join(".claude").join(n).is_file())).unwrap_or(false),
        _ => false,
    }
}

fn default_notch_y() -> f64 {
    0.5
}
fn default_scale() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}
/// A fresh install shows the two readings straight away — a tray icon nobody knows to look for is
/// a feature nobody finds. An install that predates this setting is handled in `load()` instead:
/// it keeps the plain mark it already has, so upgrading never changes anyone's icon unasked.
fn default_tray_mode() -> String {
    "numbers".into()
}
fn default_tray_providers() -> Vec<String> {
    vec!["claude".into(), "codex".into()]
}
fn default_antigravity_limit() -> String {
    "automatic".into()
}
fn default_antigravity_model() -> String {
    "gemini".into()
}

fn default_port() -> u16 {
    48666
}
fn default_lang() -> String {
    "auto".into()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            drawer_preferences: DrawerPreferences::default(),
            port: default_port(),
            lang: default_lang(),
            bar_x: None,
            bar_y: None,
            bar_w: None,
            drag_enabled: false,
            notch_y: default_notch_y(),
            providers: Default::default(),
            scale: default_scale(),
            tray_mode: default_tray_mode(),
            tray_providers: default_tray_providers(),
            tray_slots: Vec::new(), // filled in by load(), from tray_providers
            notch_providers: Vec::new(), // empty = show them all
            notch_slots: Vec::new(),     // filled in by load(), from notch_providers
            antigravity_limit: default_antigravity_limit(),
            antigravity_model: default_antigravity_model(),
            notch_visible: true,
            tray_visible: true,
        }
    }
}

pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("codenotch")
        .join("config.json")
}

pub fn load() -> Config {
    let path = config_path();
    let raw = std::fs::read_to_string(&path).ok();
    parse_config(raw.as_deref())
}

fn parse_config(raw: Option<&str>) -> Config {
    let mut cfg: Config = raw
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default();
    let value = raw.and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok());
    if let Some(value) = value.as_ref() {
        // The current switch wins once saved; do not let a stale legacy key undo it.
        if value.get("notch_visible").is_none() {
            if let Some(hidden) = value.get("panel_hidden").and_then(|v| v.as_bool()) {
                cfg.notch_visible = !hidden;
            }
        }
    }

    // Discoverability without surprising anyone. `default_tray_mode` gives a NEW install the
    // numbers icon, but serde applies that same default to an EXISTING config that simply predates
    // the setting — which would silently change the tray icon of everyone who upgrades. So an
    // existing file with no `tray_mode` key is pinned to the plain mark it already has; only a
    // machine with no config at all gets the new default.
    let upgrading = value.as_ref()
        .map(|v| v.get("tray_mode").is_none())
        .unwrap_or(false);
    if upgrading {
        cfg.tray_mode = "off".into();
    }

    // Migration: before slots existed the icon was a plain provider list, one reading each. That
    // is exactly a list of slots, so nobody's choice is lost and nobody has to reconfigure anything.
    if value.as_ref().is_none_or(|v| v.get("tray_slots").is_none()) {
        cfg.tray_slots = cfg
            .tray_providers
            .iter()
            .map(|p| TraySlot { provider: p.clone() })
            .collect();
    }

    // Same migration for the notch.
    if value.as_ref().is_none_or(|v| v.get("notch_slots").is_none()) {
        cfg.notch_slots = cfg
            .notch_providers
            .iter()
            .map(|p| TraySlot { provider: p.clone() })
            .collect();
    }

    // Both hidden would leave the app unreachable: no pill, no tray icon, no way to open settings.
    if !cfg.notch_visible && !cfg.tray_visible {
        cfg.tray_visible = true;
    }

    // A hand-edited file must not be able to produce an invisible window
    cfg.scale = cfg.scale.clamp(SCALE_MIN, SCALE_MAX);
    cfg
}

pub fn save(cfg: &Config) {
    let path = config_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(txt) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(path, txt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawer_is_minimal_for_old_and_partial_configs() {
        assert_eq!(parse_config(Some("{}")).drawer_preferences, DrawerPreferences::default());
        let cfg = parse_config(Some(r#"{"drawer_preferences":{"showPlan":true}}"#));
        assert_eq!(cfg.drawer_preferences, DrawerPreferences { show_plan: true, ..Default::default() });
        let saved = serde_json::to_string(&cfg).unwrap();
        assert_eq!(parse_config(Some(&saved)).drawer_preferences, cfg.drawer_preferences);
    }

    #[test]
    fn explicit_provider_modes_never_probe() {
        assert!(!enabled_when(ProviderMode::Hide, || panic!("hidden provider probed")));
        assert!(enabled_when(ProviderMode::Show, || panic!("forced provider probed")));
        assert!(enabled_when(ProviderMode::Auto, || true));
        assert!(!enabled_when(ProviderMode::Auto, || false));
    }

    #[test]
    fn legacy_visibility_migrates_and_survives_roundtrip() {
        let cfg = parse_config(Some(r#"{"panel_hidden":true,"providers":{"codex":"hide","cursor":"show"}}"#));
        assert!(!cfg.notch_visible);
        assert!(cfg.tray_visible);
        assert_eq!(cfg.provider_mode("codex"), ProviderMode::Hide);
        assert_eq!(cfg.provider_mode("cursor"), ProviderMode::Show);
        assert_eq!(cfg.provider_mode("claude"), ProviderMode::Auto);
        let saved = serde_json::to_string(&cfg).unwrap();
        let restored = parse_config(Some(&saved));
        assert!(!restored.notch_visible);
        assert_eq!(restored.providers, cfg.providers);
    }

    #[test]
    fn current_visibility_wins_over_legacy_key() {
        assert!(parse_config(Some(r#"{"panel_hidden":true,"notch_visible":true}"#)).notch_visible);
        assert!(!parse_config(Some(r#"{"panel_hidden":false,"notch_visible":false}"#)).notch_visible);
        let cfg = parse_config(Some(r#"{"panel_hidden":true,"tray_visible":false}"#));
        assert!(!cfg.notch_visible && cfg.tray_visible);
    }

    #[test]
    fn all_hidden_remains_explicit_with_empty_notch_slots() {
        let cfg = parse_config(Some(r#"{"providers":{"claude":"hide","codex":"hide","cursor":"hide","gemini":"hide"},"notch_slots":[]}"#));
        for id in ["claude", "codex", "cursor", "gemini"] {
            assert!(!enabled_when(cfg.provider_mode(id), || panic!("hidden provider probed")));
        }
        assert!(cfg.notch_slots.is_empty());
    }

    #[test]
    fn current_slot_keys_win_including_explicit_empty_arrays() {
        let cfg = parse_config(Some(r#"{"tray_slots":[],"tray_providers":["cursor"],"notch_slots":[],"notch_providers":["codex"]}"#));
        assert!(cfg.tray_slots.is_empty());
        assert!(cfg.notch_slots.is_empty());
        let cfg = parse_config(Some(r#"{"tray_slots":[{"provider":"codex"}],"tray_providers":["cursor"],"notch_slots":[{"provider":"cursor"}],"notch_providers":["codex"]}"#));
        assert_eq!(cfg.tray_slots[0].provider, "codex");
        assert_eq!(cfg.notch_slots[0].provider, "cursor");
    }

    #[test]
    fn legacy_lists_migrate_without_changing_existing_icon_mode() {
        let cfg = parse_config(Some(r#"{"tray_providers":["cursor"],"notch_providers":["codex"]}"#));
        assert_eq!(cfg.tray_slots[0].provider, "cursor");
        assert_eq!(cfg.notch_slots[0].provider, "codex");
        assert_eq!(cfg.tray_mode, "off");
        assert_eq!(parse_config(None).tray_mode, "numbers");
        assert_eq!(parse_config(Some(r#"{"tray_mode":"bars"}"#)).tray_mode, "bars");
    }
}
