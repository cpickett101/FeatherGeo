import { lazy, Suspense, useState, useRef } from 'react'
import MapWithDropzone from './components/MapWithDropzone'
import type { FeatureCollection } from 'geojson'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() =>
  import('./components/GeoProcessor').then(m => ({ default: m.GeoProcessor }))
)

export function App() {
  const [isProcessorOpen, setIsProcessorOpen] = useState(false)
  const [currentData, setCurrentData] = useState<FeatureCollection | null>(null)
  const mapRef = useRef<{ updateMap: (data: FeatureCollection) => void }>(null)

  const handleDataProcessed = (data: FeatureCollection) => {
    setCurrentData(data)
    // Trigger map update
    if (mapRef.current) {
      mapRef.current.updateMap(data)
    }
  }

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
        <MapWithDropzone ref={mapRef} onDataLoaded={setCurrentData} />
      </main>

      {isProcessorOpen && (
        <Suspense fallback={<div className="modal-backdrop"><p className="panel loading-panel">Loading processor...</p></div>}>
          <GeoProcessor 
            onClose={() => setIsProcessorOpen(false)} 
            currentData={currentData}
            onDataProcessed={handleDataProcessed}
          />
        </Suspense>
      )}
    </div>
  )
}
