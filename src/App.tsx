import { lazy, Suspense, useState, useEffect } from 'react'
import MapWithDropzone from './components/MapWithDropzone'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() =>
  import('./components/GeoProcessor').then(m => ({ default: m.GeoProcessor }))
)

export function App() {
  const [route, setRoute] = useState(window.location.hash)

  window.onhashchange = () => setRoute(window.location.hash)

  return (
    <div>
      <nav>
        <a href="#/">Map</a> | <a href="#/process">Process</a>
      </nav>

      {route === '#/process' ? (
        <Suspense fallback={<p>Loading GDAL...</p>}>
          <GeoProcessor />
        </Suspense>
      ) : (
        <div style={{ width: '100%', height: '90vh' }}>
          <MapWithDropzone />
        </div>
      )}
    </div>
  )
}
