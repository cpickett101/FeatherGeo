import { lazy, Suspense, useState } from 'react'
import MapWithDropzone from './components/MapWithDropzone'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() =>
  import('./components/GeoProcessor').then(m => ({ default: m.GeoProcessor }))
)

export function App() {
  const [isProcessorOpen, setIsProcessorOpen] = useState(false)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-eyebrow">Feather Geo</p>
          <h1>Shapefile Viewer</h1>
        </div>
        <button 
          className="processor-button"
          onClick={() => setIsProcessorOpen(true)}
        >
          Open Processor
        </button>
      </header>

      <main className="app-content">
        <MapWithDropzone />
      </main>

      {isProcessorOpen && (
        <Suspense fallback={<div className="modal-backdrop"><p className="panel loading-panel">Loading GDAL...</p></div>}>
          <GeoProcessor onClose={() => setIsProcessorOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
