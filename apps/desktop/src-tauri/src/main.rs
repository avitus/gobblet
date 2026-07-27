// Windows would otherwise open a console window behind the application.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gobblet_desktop_lib::run()
}
