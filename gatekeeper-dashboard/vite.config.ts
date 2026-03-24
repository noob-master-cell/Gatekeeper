import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/admin': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/metrics': 'http://localhost:8000',
      '/proxy': 'http://localhost:8000',
      '/.well-known': 'http://localhost:8000',
      '/login': 'http://localhost:8000',
      '/oauth': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
    },
  },
})
