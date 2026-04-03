import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Strip proxy env vars so vite's dev proxy connects directly to localhost
delete process.env.http_proxy
delete process.env.https_proxy
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY

const certDir = path.resolve(__dirname, '../certs')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    https: {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:18923',
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward real client IP to backend
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || '';
            if (clientIp) {
              proxyReq.setHeader('X-Forwarded-For', clientIp);
              proxyReq.setHeader('X-Real-IP', clientIp);
            }
          });
        },
      },
    },
  },
})
