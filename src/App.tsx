import { lazy, Suspense, useState, useRef, useCallback, useMemo, useEffect } from 'react'
import MapWithDropzone, { type MapWithDropzoneRef } from './components/MapWithDropzone'
import { FeaturePopup } from './components/FeaturePopup'
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import { storage, UnitSystem } from './lib/storage'
import { getDistanceUnit, convertDistanceToKm } from './lib/units'

// Lazy load GDAL only when needed
const GeoProcessor = lazy(() =>
  import('./components/GeoProcessor').then(m => ({ default: m.GeoProcessor }))
)

type ActiveTool = 'buffer' | 'simplify' | null
type OperationParams = {
  distance?: number
  tolerance?: number
}

type PolygonFeature = Feature<Polygon | MultiPolygon>

export function App() {
  const [isProcessorOpen, setIsProcessorOpen] = useState(false)
  const [showSettingsTray, setShowSettingsTray] = useState(false)
  const [currentData, setCurrentData] = useState<FeatureCollection | null>(() => {
    const session = storage.loadLastSession()
    return session ? session.data : null
  })
  const [previousData, setPreviousData] = useState<FeatureCollection | null>(null)
  const [sourceFileName, setSourceFileName] = useState<string>(() => {
    const session = storage.loadLastSession()
    return session ? session.fileName : 'feathergeo'
  })
  const [activeTool, setActiveTool] = useState<ActiveTool>(null)
  const [bufferDistance, setBufferDistance] = useState(1)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.01)
  const [toolPanelPosition, setToolPanelPosition] = useState({ left: 0, top: 0 })
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(storage.getSettings().unitSystem)
  const mapRef = useRef<MapWithDropzoneRef>(null)

  // Persist last session to cookie-like localStorage on every data change
  useEffect(() => {
    if (currentData && currentData.features.length > 0) {
      storage.saveLastSession(currentData, sourceFileName)
    }
  }, [currentData, sourceFileName])

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
    setPreviousData(currentData)
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
          const outline = turf.polygonToLine(feature as PolygonFeature)
          lengthKm += turf.length(outline, { units: 'kilometers' })
        } catch (_e) {
          // ignore perimeter errors
        }
        continue
      }
      if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        try {
          lengthKm += turf.length(feature as Feature<LineString | MultiLineString>, { units: 'kilometers' })
        } catch (_e) {
          // ignore length errors
        }
      }
    }
    return { areaSqKm, lengthKm }
  }, [currentData])

  const handleUndo = () => {
    if (!previousData) return
    setCurrentData(previousData)
    setPreviousData(null)
    if (mapRef.current) {
      mapRef.current.updateMap(previousData)
    }
  }

  const applyOperation = (operation: string, params?: OperationParams) => {
    if (!currentData || !currentData.features.length) return

    try {
      // Check if there's a selection — scope op to those features only
      const selectedIndices = mapRef.current?.getSelectedIndices() ?? []
      const hasSelection = selectedIndices.length > 0
      const targetFeatures = hasSelection
        ? currentData.features.filter((_, i) => selectedIndices.includes(i))
        : currentData.features

      let processedFeatures: typeof currentData.features

      switch (operation) {
        case 'buffer': {
          const distance = params?.distance ?? bufferDistance
          const distanceKm = convertDistanceToKm(distance)
          processedFeatures = targetFeatures.map(feature => {
            try { return turf.buffer(feature, distanceKm, { units: 'kilometers' }) } catch { return null }
          }).filter((f): f is Feature<Polygon | MultiPolygon> => f !== null)
          break
        }
        case 'simplify': {
          const tolerance = params?.tolerance ?? simplifyTolerance
          processedFeatures = targetFeatures.map(feature => {
            try { return turf.simplify(feature, { tolerance, highQuality: false }) } catch { return feature }
          })
          break
        }
        case 'centroid': {
          processedFeatures = targetFeatures.map(feature => {
            try { return turf.centroid(feature) } catch { return null }
          }).filter((f): f is NonNullable<typeof f> => f !== null)
          break
        }
        case 'convexHull': {
          const col = turf.featureCollection(targetFeatures)
          const hull = turf.convex(col)
          processedFeatures = hull ? [hull] : targetFeatures
          break
        }
        case 'bbox': {
          processedFeatures = targetFeatures.map(feature => {
            try { return turf.bboxPolygon(turf.bbox(feature)) } catch { return null }
          }).filter((f): f is NonNullable<typeof f> => f !== null)
          break
        }
        default:
          return
      }

      let result: FeatureCollection
      if (hasSelection) {
        // Merge: replace selected features with processed ones, keep the rest
        const unselected = currentData.features.filter((_, i) => !selectedIndices.includes(i))
        result = turf.featureCollection([...unselected, ...processedFeatures])
      } else {
        result = turf.featureCollection(processedFeatures)
      }

      handleDataProcessed(result)
      setActiveTool(null)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      alert(`Error: ${message}`)
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
  const [featurePopup, setFeaturePopup] = useState<{ properties: Record<string, unknown>; pixel: [number, number] } | null>(null)

  const handleFeatureClick = useCallback((properties: Record<string, unknown>, pixel: [number, number]) => {
    if (Object.keys(properties).length === 0) {
      setFeaturePopup(null)
    } else {
      setFeaturePopup({ properties, pixel })
    }
  }, [])

  const handleDeleteFeature = useCallback(() => {
    const updated = mapRef.current?.deleteSelectedFeature()
    if (updated) {
      setPreviousData(currentData)
      setCurrentData(updated)
    }
    setFeaturePopup(null)
  }, [currentData])

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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      alert(`Shapefile export failed: ${message}. Try GeoJSON instead.`)
    } finally {
      setExportBusy(null)
      setShowExportTray(false)
    }
  }, [currentData, sourceFileName])

  const hasData = currentData && currentData.features.length > 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-logo">
          <svg className="app-logo-icon" width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.76z" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="16" y1="8" x2="2" y2="22" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="17.5" y1="15" x2="9" y2="15" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="app-logo-text">Feather<span className="app-logo-accent">Geo</span></span>
        </h1>
        <div className="app-header-links">
          <span className="app-local-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            100% local
            <span className="app-local-tooltip">All processing happens in your browser</span>
          </span>
          <a className="app-github-link" href="https://github.com/cpickett101/FeatherGeo/issues" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v4"/>
              <path d="M16 2v4"/>
              <rect x="6" y="6" width="12" height="12" rx="2"/>
              <path d="M6 10h12"/>
              <circle cx="9" cy="13" r="1"/>
              <circle cx="15" cy="13" r="1"/>
            </svg>
            Report Issue
          </a>
          <a className="app-github-link" href="https://github.com/cpickett101/FeatherGeo" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Open Source
          </a>
        </div>
        <div className="app-nav">
          <button 
            className={`tool-button${activeTool === 'buffer' ? ' is-active' : ''}`}
            onClick={(e) => toggleTool('buffer', e)}
            disabled={!hasData}
            data-tooltip="Expand features outward by a set distance"
          >
            <i className="fg fg-buffer" />
            Buffer
          </button>
          <button 
            className={`tool-button${activeTool === 'simplify' ? ' is-active' : ''}`}
            onClick={(e) => toggleTool('simplify', e)}
            disabled={!hasData}
            data-tooltip="Reduce vertex count while preserving shape"
          >
            <i className="fg fg-simplify" />
            Simplify
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('centroid')}
            disabled={!hasData}
            data-tooltip="Replace each feature with its center point"
          >
            <i className="fg fg-point" />
            Centroid
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('convexHull')}
            disabled={!hasData}
            data-tooltip="Wrap all features in the smallest convex polygon"
          >
            <i className="fg fg-convex-hull" />
            Hull
          </button>
          <button 
            className="tool-button"
            onClick={() => applyOperation('bbox')}
            disabled={!hasData}
            data-tooltip="Draw a bounding box around each feature"
          >
            <i className="fg fg-bbox" />
            BBox
          </button>
          <div className="nav-divider"></div>
          {previousData && (
            <button
              className="tool-button"
              onClick={handleUndo}
              data-tooltip="Revert to previous state"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M3 13C5.5 6.5 13 4 19 7.5S23 19 17 21" />
              </svg>
              Undo
            </button>
          )}
          <div className="nav-divider"></div>
          <button 
            className={`processor-button${showSettingsTray ? ' is-active' : ''}`}
            onClick={() => setShowSettingsTray(!showSettingsTray)}
            data-tooltip="Settings"
          >
            <i className="fg fg-map-options" />
          </button>
          <button 
            className={`download-button${showExportTray ? ' is-active' : ''}`}
            onClick={() => setShowExportTray(!showExportTray)}
            disabled={!hasData}
          >
            <i className="fg fg-layer-download" />
            Export
          </button>
        </div>
      </header>

      {showSettingsTray && (
        <div className="export-tray">
          <div className="export-tray-inner">
            <div className="export-card" style={{ cursor: 'default', padding: '16px' }}>
              <span className="export-card-info" style={{ width: '100%' }}>
                <span className="export-card-format" style={{ fontWeight: 'normal' }}>Measurement Units</span>
                <select 
                  className="processor-select"
                  value={unitSystem}
                  onChange={(e) => {
                    const newSystem = e.target.value as UnitSystem
                    setUnitSystem(newSystem)
                    storage.setSettings({ unitSystem: newSystem })
                    // Force re-render of measurements
                    if (mapRef.current && currentData) {
                      mapRef.current.updateMap(currentData)
                    }
                  }}
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  <option value="metric">Metric (meters, kilometers)</option>
                  <option value="imperial">Imperial (feet, miles)</option>
                </select>
                <span className="export-card-meta" style={{ marginTop: '8px', display: 'block' }}>
                  Preference saved automatically
                </span>
              </span>
            </div>
          </div>
          <button className="export-tray-dismiss" onClick={() => setShowSettingsTray(false)}>
            Close
          </button>
        </div>
      )}

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
                <span className="export-card-format" style={{ fontWeight: 'normal' }}>GeoJSON</span>
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
                <span className="export-card-format" style={{ fontWeight: 'normal' }}>Shapefile</span>
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
                  Distance ({getDistanceUnit()})
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
          onFeatureClick={handleFeatureClick}
          dataset={currentData}
          measures={datasetMeasures}
        />
      </main>

      {featurePopup && (
        <FeaturePopup
          properties={featurePopup.properties}
          pixel={featurePopup.pixel}
          onClose={() => setFeaturePopup(null)}
          onDelete={handleDeleteFeature}
        />
      )}

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
