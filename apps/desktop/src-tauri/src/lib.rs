//! The whole native surface of the desktop application: three commands that put the
//! session token in the operating system's credential store, and a window that loads
//! the same bundle the browser gets
//! (docs/adr/0033-the-desktop-application-is-the-web-build-in-a-window.md).
//!
//! Everything else, including the confirmation before closing an active match, is
//! client code behind `isDesktop()`, so it is written once and tested with the rest
//! of the client rather than here.

use keyring::Entry;

/// The credential store's own namespacing. The account name is fixed because a
/// desktop installation holds one session at a time, which is what the window shows.
const SERVICE: &str = "ai.gobblet.online";
const ACCOUNT: &str = "session-token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
}

/// The token, or nothing. A missing entry is not a failure: it is a player who has
/// not signed in on this machine, and the client treats storage as a cache anyway.
#[tauri::command]
fn session_token_read() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn session_token_write(token: String) -> Result<(), String> {
    entry()?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_token_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            session_token_read,
            session_token_write,
            session_token_delete
        ])
        .run(tauri::generate_context!())
        .expect("the Gobblet Online window failed to start");
}
