import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { previewAllowedHosts } from './src/lib/preview-hosts.ts'

export default defineConfig(({ mode }) => ({
  server: { host: '127.0.0.1', port: 3004, strictPort: true },
  // `npm run start:line` serves the build with `vite preview`, behind the ngrok tunnel. Vite checks the Host header, so
  // the preview server accepts your tunnel's domain too. Without LINE_MODE_DOMAIN it accepts localhost only.
  preview: { host: '127.0.0.1', port: 3004, strictPort: true, allowedHosts: previewAllowedHosts(loadEnv(mode, process.cwd(), 'LINE_MODE_')) },
  // tanstackStart() must come before the React plugin.
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
}))
