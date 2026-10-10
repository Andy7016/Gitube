// 桌面版只是把网页版装进一个原生窗口里，所有功能都在前端（src/）实现。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 点击 GitHub 链接、README 里的链接时，用系统默认浏览器打开
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("启动 Gitube 失败");
}
