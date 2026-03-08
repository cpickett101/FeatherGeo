import { lazy, Suspense, useState, useRef, useCallback, useMemo } from 'react'
import MapWithDropzone from './components/MapWithDropzone'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import * as turf from '@turf/turf'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() =>
  import('./components/GeoProcessor').then(m => ({ default: m.GeoProcessor }))
)

type ActiveTool = 'buffer' | 'simplify' | null

export function App() {
  const [isProcessorOpen, setIsProcessorOpen] = useState(false)
  const [currentData, setCurrentData] = useState<FeatureCollection | null>(null)
  const [sourceFileName, setSourceFileName] = useState<string>('feathergeo')
  const [activeTool, setActiveTool] = useState<ActiveTool>(null)
  const [bufferDistance, setBufferDistance] = useState(1)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.01)
  const [toolPanelPosition, setToolPanelPosition] = useState({ left: 0, top: 0 })
  const mapRef = useRef<{ updateMap: (data: FeatureCollection) => void }>(null)

  const handleSourceDataLoaded = useCallback((data: FeatureCollection, fileName?: string) => {
    setCurrentData(data)
    if (fileName) {
      const base = fileName.replace(/\.[^.]+$/, '')
      setSourceFileName(base)
    }
    if (mapRef.current) {
      mapRef.current.updateMap(data)
    }
  }, [])

  const handleDataProcessed = (data: FeatureCollection) => {
    setCurrentData(data)
    if (mapRef.current) {
      mapRef.current.updateMap(data)
    }
  }

  const datasetMeasures = useMemo(() => {
    if (!currentData || !currentData.features.length) {
      return { areaSqKm: 0, lengthKm: 0 }
    }

    let areaSqKm = 0
    let lengthKm = 0

    for (const feature of currentData.features) {
      const geometryType = feature.geometry?.type

      if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
        areaSqKm += turf.area(feature) / 1_000_000
        try {
          const outline = turf.polygonToLine(feature as any)
          lengthKm += turf.length(outline, { units: 'kilometers' })
        } catch (e) {
          // ignore perimeter errors
        }
        continue
      }

      if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        try {
          lengthKm += turf.length(feature as any, { units: 'kilometers' })
        } catch (e) {
          // ignore length errors
        }
      }
    }

    return { areaSqKm, lengthKm }
  }, [currentData])

  const applyOperation = (operation: string, params?: any) => {
    if (!currentData || !currentData.features.length) {
      return
    }

    try {
      let result: FeatureCollection

      switch (operation) {
        case 'buffer': {
          const distance = params?.distance ?? bufferDistance
          const buffered = currentData.features.map(feature => {
            try {
              return turf.buffer(feature, distance, { units: 'kilometers' })
            } catch (e) {
              return null
            }
          }).filter((f): f is Feature<Polygon | MultiPolygon> => f !== null)
          result = turf.featureCollection(buffered)
          break
        }

        case 'simplify': {
          const tolerance = params?.tolerance ?? simplifyTolerance
          const simplified = currentData.features.map(feature => {
            try {
              return turf.simplify(feature, { tolerance, highQuality: false })
            } catch (e) {
              return feature
            }
          })
          result = turf.featureCollection(simplified)
          break
        }

        case 'centroid': {
          const centroids = currentData.features.map(feature => {
            try {
              return turf.centroid(feature)
            } catch (e) {
              return null
            }
          }).filter((f): f is NonNullable<typeof f> => f !== null)
          result = turf.featureCollection(centroids)
          break
        }

        case 'convexHull': {
          const hull = turf.convex(currentData)
          result = hull ? turf.featureCollection([hull]) : currentData
          break
        }

        case 'bbox': {
          const boxes = currentData.features.map(feature => {
            try {
              const bbox = turf.bbox(feature)
              return turf.bboxPolygon(bbox)
            } catch (e) {
              return null
            }
          }).filter((f): f is NonNullable<typeof f> => f !== null)
          result = turf.featureCollection(boxes)
          break
        }

        default:
          return
      }

      handleDataProcessed(result)
      setActiveTool(null)
    } catch (e: any) {
      alert(`Error: ${e.message}`)
    }
  }

  const toggleTool = (tool: ActiveTool, event: React.MouseEvent<HTMLButtonElement>) => {
    if (activeTool === tool) {
      setActiveTool(null)
    } else {
      const button = event.currentTarget
      const rect = button.getBoundingClientRect()
      setToolPanelPosition({ 
        left: rect.left,
        top: rect.bottom
      })
      setActiveTool(tool)
    }
  }

  const [showExportTray, setShowExportTray] = useState(false)
  const [exportBusy, setExportBusy] = useState<string | null>(null)

  const estimateSize = useCallback((data: FeatureCollection | null): string => {
    if (!data) return '0 B'
    const bytes = new Blob([JSON.stringify(data)]).size
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }, [])

  const makeExportName = useCallback((ext: string) => {
    const rand = Math.floor(Math.random() * 9000 + 1000)
    return `${sourceFileName}_exported_${rand}.${ext}`
  }, [sourceFileName])

  const downloadAsGeoJSON = useCallback(() => {
    if (!currentData || !currentData.features.length) return
    setExportBusy('geojson')
    try {
      const dataStr = JSON.stringify(currentData, null, 2)
      const blob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = makeExportName('geojson')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } finally {
      setExportBusy(null)
      setShowExportTray(false)
    }
  }, [currentData, makeExportName])

  const downloadAsShapefile = useCallback(async () => {
    if (!currentData || !currentData.features.length) return
    setExportBusy('shp')
    try {
      const [{ GDALService }, JSZip] = await Promise.all([
        import('./lib/gdalService'),
        import('jszip').then(m => m.default)
      ])
      const gdal = await GDALService.getInstance()
      const rand = Math.floor(Math.random() * 9000 + 1000)
      const exportBase = `${sourceFileName}_exported_${rand}`
      const shpFiles = await gdal.exportToShapefile(currentData, exportBase)

      const zip = new JSZip()
      const folder = zip.folder(exportBase)!
      for (const [name, bytes] of shpFiles) {
        folder.file(name, bytes)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${exportBase}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`Shapefile export failed: ${e.message}. Try GeoJSON instead.`)
    } finally {
      setExportBusy(null)
      setShowExportTray(false)
    }
  }, [currentData, makeExportName])

  const hasData = currentData && currentData.features.length > 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-logo">
          <svg className="app-logo-icon" width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0d9488" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>
            </defs>
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.76z" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="16" y1="8" x2="2" y2="22" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="17.5" y1="15" x2="9" y2="15" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="app-logo-text">Feather<span className="app-logo-accent">Geo</span></span>
        </h1>
        <a className="app-github-link" href="https://github.com/cpickett101/FeatherGeo" target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Open Source
        </a>
        <div className="app-nav">
          <button 
            className={`tool-button${activeTool === 'buffer' ? ' is-active' : ''}`}
            onClick={(e) => toggleTool('buffer', e)}
            disabled={!hasData}
            title="Buffer"
          >
            <i className="fg fg-buffer" />
            Buffer
          </button>
          <button 
            className={`tool-button${activeTool === 'simplify' ? ' is-active' : ''}`}
            onClick={(e) => toggleTool('simplify', e)}
            disabled={!hasData}
            title="Simplify"
          >
            <i className="fg fg-simplify" />
            Simplify
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('centroid')}
            disabled={!hasData}
            title="Centroid"
          >
            <i className="fg fg-point" />
            Centroid
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('convexHull')}
            disabled={!hasData}
            title="Convex Hull"
          >
            <i className="fg fg-convex-hull" />
            Hull
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('bbox')}
            disabled={!hasData}
            title="Bounding Box"
          >
            <i className="fg fg-bbox" />
            BBox
          </button>
          <div className="nav-divider"></div>
          <button 
            className={`download-button${showExportTray ? ' is-active' : ''}`}
            onClick={() => setShowExportTray(!showExportTray)}
            disabled={!hasData}
            title="Export data"
          >
            <i className="fg fg-layer-download" />
            Export
          </button>
          <button 
            className="processor-button"
            onClick={() => setIsProcessorOpen(true)}
            title="Advanced Processing"
          >
            <i className="fg fg-map-options" />
          </button>
        </div>
      </header>

      {showExportTray && hasData && (
        <div className="export-tray">
          <div className="export-tray-inner">
            <button
              className={`export-card${exportBusy === 'geojson' ? ' is-busy' : ''}`}
              onClick={downloadAsGeoJSON}
              disabled={!!exportBusy}
            >
              <span className="export-card-icon">{ }</span>
              <span className="export-card-info">
                <span className="export-card-format">GeoJSON</span>
                <span className="export-card-meta">{estimateSize(currentData)} · {currentData!.features.length} features</span>
              </span>
              <span className="export-card-action">{exportBusy === 'geojson' ? 'Saving…' : 'Download'}</span>
            </button>
            <button
              className={`export-card${exportBusy === 'shp' ? ' is-busy' : ''}`}
              onClick={downloadAsShapefile}
              disabled={!!exportBusy}
            >
              <span className="export-card-icon">.shp</span>
              <span className="export-card-info">
                <span className="export-card-format">Shapefile</span>
                <span className="export-card-meta">.zip bundle · via GDAL</span>
              </span>
              <span className="export-card-action">{exportBusy === 'shp' ? 'Converting…' : 'Download'}</span>
            </button>
          </div>
          <button className="export-tray-dismiss" onClick={() => setShowExportTray(false)}>
            Cancel
          </button>
        </div>
      )}

      {activeTool && (
        <div className="tool-panel-overlay" style={{ left: `${toolPanelPosition.left}px`, top: `${toolPanelPosition.top}px` }}>
          <div className="tool-panel">
            {activeTool === 'buffer' && (
              <div className="tool-panel-content">
                <label className="tool-panel-label">
                  Distance (km)
                  <input
                    type="number"
                    className="tool-panel-input"
                    value={bufferDistance}
                    onChange={(e) => setBufferDistance(Number(e.target.value))}
                    min="0.1"
                    step="0.1"
                  />
                </label>
                <button
                  className="primary-button"
                  onClick={() => applyOperation('buffer')}
                >
                  Apply Buffer
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setActiveTool(null)}
                >
                  Cancel
                </button>
              </div>
            )}

            {activeTool === 'simplify' && (
              <div className="tool-panel-content">
                <label className="tool-panel-label">
                  Tolerance
                  <input
                    type="number"
                    className="tool-panel-input"
                    value={simplifyTolerance}
                    onChange={(e) => setSimplifyTolerance(Number(e.target.value))}
                    min="0.001"
                    step="0.001"
                  />
                </label>
                <small className="tool-panel-hint">Lower values preserve more detail</small>
                <button
                  className="primary-button"
                  onClick={() => applyOperation('simplify')}
                >
                  Apply Simplify
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setActiveTool(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="app-content">
        <MapWithDropzone
          ref={mapRef}
          onDataLoaded={handleSourceDataLoaded}
          dataset={currentData}
          measures={datasetMeasures}
        />
      </main>

      {isProcessorOpen && (
        <Suspense fallback={null}>
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
