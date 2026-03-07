import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['gdal3.js'] // Don't pre-bundle WASM
  },
  worker: {
    format: 'es' // For GDAL workers
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Chunk WASM separately
        manualChunks: {
          gdal: ['gdal3.js']
        }
      }
    }
  }
})
