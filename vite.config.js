import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Bind to the LAN IP and allow temporary demo tunnels, but keep Vite's
  // Host-header check on (a bare `allowedHosts: true` disables it, opening a
  // DNS-rebinding path to the dev server). Scope it to localhost + the tunnel
  // providers we actually use; add more hosts here if you switch providers.
  server: {
    host: true,
    allowedHosts: ['localhost', '.trycloudflare.com', '.loca.lt', '.ngrok-free.app'],
  },
  preview: {
    host: true,
    allowedHosts: ['localhost', '.trycloudflare.com', '.loca.lt', '.ngrok-free.app'],
  },
  build: {
    rollupOptions: {
      output: {
        // Pin React + router into their own chunk. They almost never change
        // between deploys, so the browser keeps them cached across releases
        // and only re-downloads the small app chunk.
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          // Portal-only vendors. Split so the public site never downloads
          // them and the portal chunk stays small when only app code changes.
          if (
            id.includes('node_modules/@supabase/') ||
            id.includes('node_modules/@tanstack/')
          ) {
            return 'vendor-supabase'
          }
        },
      },
    },
  },
})
