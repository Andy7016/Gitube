import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('./gitube', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:5314' },
  },
  preview: { host: '127.0.0.1', port: 4173 },
})
