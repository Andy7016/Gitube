import { Navigate } from 'react-router'
/** OAuth 回调和凭据交换完全由服务端处理。保留导出供旧入口安全跳转。 */
export function OAuthCallback(){return <Navigate to="/" replace/>}
