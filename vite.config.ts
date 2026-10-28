import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 用相对路径打包：同一份 dist/ 既能放在 GitHub Pages 的子路径 /Gitube/ 下，也能被桌面版直接加载
  base: './',
  plugins: [react()],
  // 下面几项是给桌面版（Tauri）开发时用的
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  preview: { port: 4173 },
})
