import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/ol/')) return 'vendor-ol'
          if (id.includes('node_modules/@turf/')) return 'vendor-turf'
          if (id.includes('node_modules/proj4/')) return 'vendor-proj'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
        }
      }
    }
  }
})
