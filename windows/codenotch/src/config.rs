use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,
    /// "auto" | "zh" | "en" | "ja" | "ko"
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
    #[serde(default)]
    pub providers: std::collections::BTreeMap<String, ProviderMode>,
    #[serde(default)]
    pub panel_hidden: bool,
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
    match mode { ProviderMode::Hide => false, ProviderMode::Show => true, ProviderMode::Auto => detect() }
}

fn detected(id: &str) -> bool {
    if !crate::glyphs::app_candidates(id).is_empty() { return true; }
    match id {
        "codex" => crate::codex::present(),
        "claude" => dirs::home_dir().map(|h| [".credentials.json", "credentials.json"].iter()
            .any(|n| h.join(".claude").join(n).is_file())).unwrap_or(false),
        // A leftover database/directory alone is not evidence of an installed app.
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_modes_never_probe_the_provider() {
        assert!(!enabled_when(ProviderMode::Hide, || panic!("hidden provider probed")));
        assert!(enabled_when(ProviderMode::Show, || panic!("forced provider probed")));
        assert!(enabled_when(ProviderMode::Auto, || true));
        assert!(!enabled_when(ProviderMode::Auto, || false));
    }
    #[test]
    fn old_config_defaults_to_auto_and_modes_roundtrip() {
        let mut c: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(c.provider_mode("cursor"), ProviderMode::Auto);
        c.providers.insert("cursor".into(), ProviderMode::Hide);
        let saved = serde_json::to_string(&c).unwrap();
        assert_eq!(serde_json::from_str::<Config>(&saved).unwrap().provider_mode("cursor"), ProviderMode::Hide);
    }
}

fn default_notch_y() -> f64 {
    0.5
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
            port: default_port(),
            lang: default_lang(),
            bar_x: None,
            bar_y: None,
            bar_w: None,
            drag_enabled: false,
            notch_y: default_notch_y(),
            providers: Default::default(),
            panel_hidden: false,
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
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
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
