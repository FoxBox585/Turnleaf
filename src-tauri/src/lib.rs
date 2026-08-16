#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .setup(|app| {
            // The leather bar doubles as the window's drag handle, and the
            // traffic lights float over it. AppKit parks the buttons at the
            // very top of the window; tao's trafficLightPosition config only
            // moves them sideways, so the vertical nudge happens here, once,
            // after the window exists. It puts them where the old native
            // build kept them — centred on the bar.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                lower_traffic_lights(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn lower_traffic_lights(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSButton, NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;

    let Ok(ns_window) = window.ns_window() else { return };
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else { return };
    let Some(mini) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else { return };
    let Some(zoom) = window.standardWindowButton(NSWindowButton::ZoomButton) else { return };

    // The titlebar container is a non-flipped view: origin y = 0 pins the
    // buttons to its bottom edge, which lands them ~18–32pt from the window
    // top — centred on the 52px leather bar instead of hugging the top.
    // Spacing and left inset stay the system's own.
    let space = mini.frame().origin.x - close.frame().origin.x;
    let buttons: [&NSButton; 3] = [&*close, &*mini, &*zoom];
    for (i, button) in buttons.iter().enumerate() {
        button.setFrameOrigin(NSPoint::new(14.0 + i as f64 * space, 0.0));
    }
}
