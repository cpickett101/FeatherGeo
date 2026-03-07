import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import { fromLonLat } from 'ol/proj'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() => import('./components/GeoProcessor'))

export function App() {
  const [route, setRoute] = useState(window.location.hash)
  const mapRef = useRef<Map | null>(null)

  window.onhashchange = () => setRoute(window.location.hash)

  useEffect(() => {
    if (route !== '#/process' && !mapRef.current) {
      mapRef.current = new Map({
        target: 'map',
        layers: [new TileLayer({ source: new OSM() })],
        view: new View({ center: fromLonLat([0, 20]), zoom: 2 }),
      })
    }
  }, [route])

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
        <div id="map" style={{ width: '100%', height: '90vh' }} />
      )}
    </div>
  )
}
