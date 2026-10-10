// Windows 正式版不弹出额外的命令行窗口，不要删
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gitube_lib::run();
}
