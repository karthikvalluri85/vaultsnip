//! VaultSnip on the desktop: the web app (../../web) in a window, plus three things a web page cannot do:
//! a system-wide hotkey, a screenshot of the screen, and the clipboard without a click.
//!
//! Nothing here talks to the network. The screenshot goes from the screen to the webview and back to the clipboard
//! as pixels in memory; no file is written and nothing is stored.

use base64::Engine;
use std::io::Cursor;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The hotkey: Ctrl+Alt+V on Windows and Linux, Control+Option+V on macOS. Chosen to stay clear of the system's own
/// screenshot keys (Win+Shift+S, Cmd+Shift+4) and the "Save as" shortcuts of most apps.
fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV)
}
const WINDOW: &str = "main";

/// Takes a screenshot of the monitor the pointer is on (the primary one if that cannot be told), with the VaultSnip
/// window hidden so it does not appear in it, and hands the picture to the page as a PNG data URL. The page opens its
/// crop screen on it.
fn snip(app: &AppHandle) {
    let app = app.clone();
    // off the event loop: the capture takes a moment and must not freeze the window
    std::thread::spawn(move || {
        let win = app.get_webview_window(WINDOW);
        let was_visible = win.as_ref().map(|w| w.is_visible().unwrap_or(true)).unwrap_or(false);
        if let Some(w) = &win {
            let _ = w.hide();
        }
        // let the window manager finish hiding the window before the screen is read
        std::thread::sleep(std::time::Duration::from_millis(220));
        let shot = capture_png();
        if let Some(w) = &win {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        match shot {
            Ok(png) => {
                let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png));
                let _ = app.emit("snip", url);
            }
            Err(e) => {
                log::error!("screenshot failed: {e}");
                let _ = app.emit("snip-error", e);
                if !was_visible {
                    if let Some(w) = &win {
                        let _ = w.show();
                    }
                }
            }
        }
    });
}

fn capture_png() -> Result<Vec<u8>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitor found".into());
    }
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or("no monitor found")?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Puts a PNG (as a data URL from the page) on the system clipboard. The page's own clipboard API needs a click and
/// does not work in every webview; this does not.
#[tauri::command]
fn copy_png(app: AppHandle, data_url: String) -> Result<(), String> {
    let b64 = data_url.split(',').nth(1).ok_or("not a data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let image = Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
    app.clipboard().write_image(&image).map_err(|e| e.to_string())
}

/// Lets the page ask for a snip too (a button on the start screen).
#[tauri::command]
fn snip_now(app: AppHandle) {
    snip(&app);
}

#[tauri::command]
fn hotkey_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Control+Option+V"
    } else {
        "Ctrl+Alt+V"
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &hotkey() && event.state() == ShortcutState::Pressed {
                        snip(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![copy_png, snip_now, hotkey_label])
        .setup(|app| {
            if let Err(e) = app.global_shortcut().register(hotkey()) {
                log::error!("could not register the hotkey: {e}");
            }
            // tray: snip, show, quit; closing the window only hides it, so the hotkey keeps working
            let snip_item = MenuItem::with_id(app, "snip", "Snip the screen", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show VaultSnip", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&snip_item, &show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .menu(&menu)
                .tooltip("VaultSnip")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "snip" => snip(app),
                    "show" => {
                        if let Some(w) = app.get_webview_window(WINDOW) {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // keep running in the tray so the hotkey still works; Quit is in the tray menu
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running VaultSnip");
}
