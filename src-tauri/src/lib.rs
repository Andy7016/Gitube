// 桌面版只是把网页版装进一个原生窗口里，几乎所有功能都在前端（src/）实现。
// 唯一的例外是「使用 GitHub 账号登录」（设备码登录）：GitHub 的登录接口不允许网页跨域调用，
// 所以由这里的 Rust 代码代发请求，而且只会访问下面两个固定地址。

use std::time::Duration;

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

/// 向 GitHub 发一个表单 POST 请求，把返回的 JSON 原样交给前端处理
async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Gitube/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化网络请求失败：{e}"))?;
    let res = client
        .post(url)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("连不上 GitHub，请检查网络或代理：{e}"))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("读取 GitHub 的返回内容失败：{e}"))?;
    serde_json::from_str(&text)
        .map_err(|_| format!("GitHub 返回了看不懂的内容（HTTP {}）", status.as_u16()))
}

/// 第 1 步：向 GitHub 申请一个验证码（用户要在浏览器里输入它）
#[tauri::command]
async fn github_device_code(client_id: String, scope: String) -> Result<serde_json::Value, String> {
    post_form(
        DEVICE_CODE_URL,
        &[("client_id", client_id.as_str()), ("scope", scope.as_str())],
    )
    .await
}

/// 第 2 步：查询用户有没有在浏览器里点「授权」。前端会按 GitHub 要求的间隔反复调用，
/// 授权完成后 GitHub 会在返回内容里给出 access_token
#[tauri::command]
async fn github_device_token(
    client_id: String,
    device_code: String,
) -> Result<serde_json::Value, String> {
    post_form(
        ACCESS_TOKEN_URL,
        &[
            ("client_id", client_id.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ],
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 点击 GitHub 链接、README 里的链接时，用系统默认浏览器打开
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![github_device_code, github_device_token])
        .run(tauri::generate_context!())
        .expect("启动 Gitube 失败");
}
