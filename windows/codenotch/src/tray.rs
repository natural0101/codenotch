use crate::i18n::tr;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let lang = {
        let st = app.state::<crate::AppState>();
        let c = st.cfg.lock().unwrap();
        c.lang.clone()
    };
    let menu = build_menu(app, &lang)?;
    // The application's own icon rather than the monochrome tray glyph: see trayicon::app_mark
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-color.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(concat!("Codenotch v", env!("CARGO_PKG_VERSION")))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, ev| handle(app, ev.id().as_ref()))
        .build(app)?;
    Ok(())
}

/// Provider modes control workers, independently of the ring selection in Settings.
pub fn build_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<Wry>> {
    let cfg = app.state::<crate::AppState>().cfg.lock().unwrap().clone();
    let russian = if lang == "auto" { crate::i18n::resolve_auto() == "ru" } else { lang == "ru" };
    let mut services = SubmenuBuilder::new(app, if russian { "Сервисы" } else { "Services" });
    for id in crate::TRAY_PROVIDER_IDS {
        let mut service = SubmenuBuilder::new(app, crate::provider_label(id));
        for (value, title, mode) in [
            ("auto", if russian { "Авто" } else { "Auto" }, crate::config::ProviderMode::Auto),
            ("show", if russian { "Показывать" } else { "Show" }, crate::config::ProviderMode::Show),
            ("hide", if russian { "Скрыть" } else { "Hide" }, crate::config::ProviderMode::Hide),
        ] {
            let item = CheckMenuItemBuilder::with_id(format!("provider-{id}-{value}"), title)
                .checked(cfg.provider_mode(id) == mode).build(app)?;
            service = service.item(&item);
        }
        services = services.item(&service.build()?);
    }
    let services = services.build()?;
    let accounts = MenuItemBuilder::with_id("accounts", if russian { "Аккаунты Codex" } else { "Codex accounts" }).build(app)?;
    let settings = MenuItemBuilder::with_id("settings", tr(lang, "settings")).build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", tr(lang, "refresh")).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", tr(lang, "quit")).build(app)?;
    MenuBuilder::new(app)
        .item(&settings)
        .item(&accounts)
        .item(&services)
        .item(&refresh)
        .separator()
        .item(&quit)
        .build()
}

/// Rebuilds the tray menu, ALWAYS on the main thread.
///
/// A menu is a Windows UI object. Building one or swapping it in from another thread leaves the
/// tray holding a menu that never opens again — and since changing the language is what triggers a
/// rebuild, the user is then locked out of the only place they could change it back. The tray's own
/// click handlers already run on the main thread, but commands from the settings window do not, so
/// the hop is done here once rather than being remembered at every call site.
pub fn refresh_menu(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let lang = {
            let st = handle.state::<crate::AppState>();
            let c = st.cfg.lock().unwrap();
            c.lang.clone()
        };
        if let Some(tray) = handle.tray_by_id("main") {
            if let Ok(menu) = build_menu(&handle, &lang) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    });
}

fn handle(app: &AppHandle, id: &str) {
    if let Some(choice) = id.strip_prefix("provider-") {
        if let Some((provider, value)) = choice.rsplit_once('-') {
            if !crate::glyphs::IDS.contains(&provider) { return; }
            let mode = match value {
                "auto" => crate::config::ProviderMode::Auto,
                "show" => crate::config::ProviderMode::Show,
                "hide" => crate::config::ProviderMode::Hide,
                _ => return,
            };
            let st = app.state::<crate::AppState>();
            let mut cfg = st.cfg.lock().unwrap();
            if cfg.provider_mode(provider) == mode { return; }
            let mut next = cfg.clone();
            next.providers.insert(provider.into(), mode);
            let saved = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())
                .and_then(|text| std::fs::write(crate::config::config_path(), text).map_err(|e| e.to_string()));
            if let Err(error) = saved {
                drop(cfg);
                let _ = app.emit("notice", format!("Could not save provider mode: {error}"));
                return;
            }
            *cfg = next;
            drop(cfg);
            // Only Codenotch restarts: worker gating is applied once at startup.
            app.restart();
        }
        return;
    }
    match id {
        "accounts" => crate::open_codex_accounts(app.clone()),
        "refresh" => {
            {
                let st = app.state::<crate::AppState>();
                let mut u = st.usage.lock().unwrap();
                u.backoff_until = 0;
            }
            crate::usage::request_refresh();
            crate::codex::request_refresh();
            crate::cursor::request_refresh();
            crate::antigravity::request_refresh();
            let a = app.clone();
            std::thread::spawn(move || crate::reload_glyphs(&a));
        }
        "settings" => {
            if let Some(w) = app.get_webview_window("settings") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
