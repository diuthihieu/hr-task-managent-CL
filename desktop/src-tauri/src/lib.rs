//! Basework desktop shell.
//!
//! The desktop app is a native window around the production web app: all UI,
//! authentication (NextAuth session cookie), authorization and data come from
//! the same server and PostgreSQL database the browser uses. This crate only
//! owns window chrome, navigation policy and (optionally) self-updates.
//!
//! Security posture:
//! - Remote pages get **no** Tauri IPC access (no `remote` capability).
//! - The window may only navigate within the configured server origin (plus
//!   the bundled bootstrap page); any other link opens in the default browser.

use tauri::{webview::WebviewWindowBuilder, Url, WebviewUrl};

const SERVER_URL: &str = env!("BASEWORK_SERVER_URL");
// Chromium/WebView2-compatible UA plus a product token the web app uses to
// recognise the desktop client (hides the "Download desktop app" entry, shows
// the installed version on /download).
const BASE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

fn server_origin() -> Url {
    Url::parse(SERVER_URL).expect("BASEWORK_SERVER_URL is a valid URL")
}

/// Navigation policy: stay inside the Basework server or the bundled shell.
fn is_allowed_navigation(url: &Url, server: &Url) -> bool {
    let bundled = url.scheme() == "tauri"
        || matches!(url.host_str(), Some("tauri.localhost"))
        || url.scheme() == "about"
        || url.scheme() == "data";
    let same_origin = url.scheme() == server.scheme()
        && url.host_str() == server.host_str()
        && url.port_or_known_default() == server.port_or_known_default();
    bundled || same_origin
}

pub fn run() {
    #[cfg_attr(not(feature = "updater"), allow(unused_mut))]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(feature = "updater")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            let version = app.package_info().version.to_string();
            let server = server_origin();
            let nav_server = server.clone();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Basework")
                .inner_size(1360.0, 860.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .user_agent(&format!("{BASE_USER_AGENT} BaseworkDesktop/{version}"))
                .on_navigation(move |url| {
                    if is_allowed_navigation(url, &nav_server) {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;

            #[cfg(feature = "updater")]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = install_update_if_available(handle).await {
                        eprintln!("update check failed: {err}");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Basework desktop");
}

/// Checks the Basework update endpoint (same server, /api/desktop/update/...)
/// and installs a newer signed release, then restarts into it.
#[cfg(feature = "updater")]
async fn install_update_if_available(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;
    if let Some(update) = app.updater()?.check().await? {
        update.download_and_install(|_chunk, _total| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_policy() {
        let server = Url::parse("https://basework.example.com").unwrap();
        let ok = |s: &str| is_allowed_navigation(&Url::parse(s).unwrap(), &server);
        assert!(ok("https://basework.example.com/w/hr/p/123?view=1"));
        assert!(ok("http://tauri.localhost/index.html"));
        assert!(ok("tauri://localhost/index.html"));
        assert!(!ok("http://basework.example.com/"), "scheme must match");
        assert!(!ok("https://basework.example.com:8443/"), "port must match");
        assert!(!ok("https://evil.example.com/"));
        assert!(!ok("https://basework.example.com.evil.com/"));
    }
}
