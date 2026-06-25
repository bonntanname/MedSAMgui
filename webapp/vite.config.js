import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // forward API calls to the FastAPI backend (uvicorn on :8000)
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
