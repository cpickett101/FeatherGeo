import React, { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { AboutModal } from './AboutModal'
import { Map as OLMap, View } from 'ol'
import { GeoJSON } from 'ol/format'
import VectorLayer from 'ol/layer/Vector'
import TileLayer from 'ol/layer/Tile'
import VectorSource from 'ol/source/Vector'
import OSM from 'ol/source/OSM'
import XYZ from 'ol/source/XYZ'
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style'
import { DragBox, DragPan } from 'ol/interaction'
import { platformModifierKeyOnly } from 'ol/events/condition'
import type { FeatureLike } from 'ol/Feature'
import OLFeature from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import { fromLonLat } from 'ol/proj'
import type { FeatureCollection } from 'geojson'
import { GDALService } from '../lib/gdalService'
import JSZip from 'jszip'
import { formatArea, formatDistance } from '../lib/units'

const BASEMAPS = [
  { id: 'osm', label: 'Streets' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topo' },
  { id: 'dark', label: 'Dark' },
] as const

type BasemapId = typeof BASEMAPS[number]['id']

function createBasemapLayer(id: BasemapId): TileLayer<OSM | XYZ> {
  switch (id) {
    case 'satellite':
      return new TileLayer({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attributions: 'Tiles © Esri',
          maxZoom: 19,
        }),
      })
    case 'topo':
      return new TileLayer({
        source: new XYZ({
          url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
          attributions: '© OpenTopoMap contributors',
          maxZoom: 17,
        }),
      })
    case 'dark':
      return new TileLayer({
        source: new XYZ({
          url: 'https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          attributions: '© CARTO',
          maxZoom: 19,
        }),
      })
    case 'osm':
    default:
      return new TileLayer({ source: new OSM() })
  }
}

interface MapWithDropzoneProps {
  onDataLoaded?: (data: FeatureCollection, fileName?: string) => void
  onFeatureClick?: (properties: Record<string, unknown>, pixel: [number, number]) => void
  onDeleteSelectedFeature?: () => void
  dataset?: FeatureCollection | null
  measures?: { areaSqKm: number; lengthKm: number }
}

export interface MapWithDropzoneRef {
  updateMap: (data: FeatureCollection) => void
  deleteSelectedFeature: () => FeatureCollection | null
  getSelectedFeatures: () => FeatureLike[]
  getSelectedIndices: () => number[]
}

type ImportStatusTone = 'neutral' | 'success' | 'error'


const SHAPEFILE_EXTENSIONS = ['.shp', '.dbf', '.shx', '.prj', '.cpg', '.qpj', '.shp.xml']
const GEOJSON_EXTENSIONS = ['.geojson', '.json']

const MapWithDropzone = forwardRef<MapWithDropzoneRef, MapWithDropzoneProps>(({ onDataLoaded, onFeatureClick, onDeleteSelectedFeature, dataset, measures }, ref) => {
  const mapRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapInstance = useRef<OLMap | null>(null)
  const basemapLayerRef = useRef<TileLayer<OSM | XYZ> | null>(null)
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const selectedFeatureRef = useRef<FeatureLike | null>(null)
  const selectedFeaturesRef = useRef<Set<FeatureLike>>(new Set())
  const dragBoxRef = useRef<DragBox | null>(null)
  const dragPanRef = useRef<DragPan | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState('Select or drop a shapefile or GeoJSON file to render it on the map.')
  const [statusTone, setStatusTone] = useState<ImportStatusTone>('neutral')
  const [loadedFiles, setLoadedFiles] = useState<string[]>([])
  const [featureCount, setFeatureCount] = useState(0)
  const [geometrySummary, setGeometrySummary] = useState<string>('No data loaded')
  const [activeBasemap, setActiveBasemap] = useState<BasemapId>('osm')
  const [currentGeoJSON, setCurrentGeoJSON] = useState<FeatureCollection | null>(null)

  const onFeatureClickRef = useRef(onFeatureClick)
  useEffect(() => { onFeatureClickRef.current = onFeatureClick }, [onFeatureClick])

  useEffect(() => {
    if (!mapRef.current) return

    const basemapLayer = createBasemapLayer('osm')
    basemapLayerRef.current = basemapLayer

    const map = new OLMap({
      target: mapRef.current,
      layers: [basemapLayer],
      view: new View({
        center: fromLonLat([0, 0]),
        zoom: 2
      })
    });

    mapInstance.current = map

    // Store reference to the default DragPan interaction
    map.getInteractions().forEach((interaction) => {
      if (interaction instanceof DragPan) {
        dragPanRef.current = interaction
      }
    })

    // Click handler for feature inspection
    map.on('click', (evt) => {
      if (!selectModeRef.current && !multiSelectModeRef.current) return
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f, { hitTolerance: 4 })
      if (feature) {
        if (multiSelectModeRef.current) {
          // Toggle feature in/out of multi-selection set
          if (selectedFeaturesRef.current.has(feature)) {
            selectedFeaturesRef.current.delete(feature)
            selectedFeatureRef.current = null
          } else {
            selectedFeaturesRef.current.add(feature)
            selectedFeatureRef.current = feature
          }
        } else {
          selectedFeaturesRef.current.clear()
          selectedFeaturesRef.current.add(feature)
          selectedFeatureRef.current = feature
        }
        vectorLayerRef.current?.changed()
        if (!multiSelectModeRef.current) {
          const props = (feature.getProperties?.() ?? {}) as Record<string, unknown>
          const { geometry: _g, ...displayProps } = props
          const nativeEvt = evt.originalEvent as MouseEvent
          onFeatureClickRef.current?.(displayProps, [nativeEvt.clientX, nativeEvt.clientY])
        }
      } else {
        selectedFeatureRef.current = null
        selectedFeaturesRef.current.clear()
        vectorLayerRef.current?.changed()
        if (!multiSelectModeRef.current) {
          onFeatureClickRef.current?.({} as Record<string, unknown>, [0, 0])
        }
      }
    })

    // Pointer cursor on hover (only in select mode)
    map.on('pointermove', (evt) => {
      if (!selectModeRef.current && !multiSelectModeRef.current) {
        const target = map.getTargetElement() as HTMLElement
        target.style.cursor = ''
        return
      }
      const hit = map.hasFeatureAtPixel(evt.pixel)
      const target = map.getTargetElement() as HTMLElement
      target.style.cursor = hit ? 'pointer' : ''
    })

    return () => {
      if (map) {
        map.setTarget(undefined)
      }
    }
  }, [])

  // Render restored session data once map is ready
  useEffect(() => {
    if (dataset && dataset.features.length > 0 && mapInstance.current) {
      displayGeoJSON(dataset)
      setFeatureCount(dataset.features.length)
      setGeometrySummary(summarizeGeometry(dataset.features))
      setStatus(`Restored ${dataset.features.length} feature${dataset.features.length === 1 ? '' : 's'} from last session.`)
      setStatusTone('success')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount only

  const toggleSelectMode = useCallback(() => {
    const next = !selectModeRef.current
    selectModeRef.current = next
    setSelectMode(next)
    // Turn off multi-select and restore pan
    multiSelectModeRef.current = false
    setMultiSelectMode(false)
    dragPanRef.current?.setActive(true)
    if (dragBoxRef.current) {
      mapInstance.current?.removeInteraction(dragBoxRef.current)
      dragBoxRef.current = null
    }
    if (!next) {
      selectedFeatureRef.current = null
      selectedFeaturesRef.current.clear()
      vectorLayerRef.current?.changed()
      onFeatureClick?.({} as Record<string, unknown>, [0, 0])
    }
  }, [onFeatureClick])

  const toggleMultiSelectMode = useCallback(() => {
    const next = !multiSelectModeRef.current
    multiSelectModeRef.current = next
    setMultiSelectMode(next)
    const map = mapInstance.current
    if (next) {
      // Turn off single select
      selectModeRef.current = false
      setSelectMode(false)
      // Disable pan
      dragPanRef.current?.setActive(false)
      // Add drag-box interaction
      const dragBox = new DragBox({ condition: () => true })
      dragBox.on('boxend', () => {
        const extent = dragBox.getGeometry().getExtent()
        const source = vectorLayerRef.current?.getSource()
        if (!source) return
        source.forEachFeatureIntersectingExtent(extent, (feature) => {
          selectedFeaturesRef.current.add(feature)
          selectedFeatureRef.current = feature
        })
        vectorLayerRef.current?.changed()
        // Don't show attribute popup in multi-select mode
        // onFeatureClickRef.current is intentionally not called here
      })
      map?.addInteraction(dragBox)
      dragBoxRef.current = dragBox
    } else {
      // Re-enable pan
      dragPanRef.current?.setActive(true)
      // Remove drag-box
      if (dragBoxRef.current) {
        map?.removeInteraction(dragBoxRef.current)
        dragBoxRef.current = null
      }
      // Clear multi-selection, keep only last selected
      const last = selectedFeatureRef.current
      selectedFeaturesRef.current.clear()
      if (last) selectedFeaturesRef.current.add(last)
      vectorLayerRef.current?.changed()
    }
  }, [onFeatureClick])

  const switchBasemap = useCallback((id: BasemapId) => {
    const map = mapInstance.current
    if (!map) return
    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current)
    }
    const newLayer = createBasemapLayer(id)
    // Insert at index 0 so vector layer stays on top
    map.getLayers().insertAt(0, newLayer)
    basemapLayerRef.current = newLayer
    setActiveBasemap(id)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const summarizeGeometry = (features: FeatureCollection['features']) => {
    const counts: Record<string, number> = {}

    for (const feature of features) {
      const geometryType = feature.geometry?.type ?? 'Unknown'
      counts[geometryType] = (counts[geometryType] ?? 0) + 1
    }

    const entries = Object.entries(counts)
    if (!entries.length) {
      return 'No geometry'
    }

    return entries
      .map(([type, count]) => `${type}: ${count}`)
      .join(' | ')
  }

  const displayGeoJSON = useCallback((geojson: FeatureCollection) => {
    const map = mapInstance.current
    if (!map) return

    setCurrentGeoJSON(geojson)

    if (vectorLayerRef.current) {
      map.removeLayer(vectorLayerRef.current)
    }

    const format = new GeoJSON()
    const olFeatures = geojson.features.map((f, i) => {
      const olFeature = format.readFeature(f, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }) as OLFeature<Geometry>
      olFeature.set('_idx', i)
      return olFeature
    })

    const vectorSource = new VectorSource<OLFeature<Geometry>>({ features: olFeatures })

    const newVectorLayer = new VectorLayer({
      source: vectorSource,
      style: (feature) => {
        const isSelected = selectedFeaturesRef.current.has(feature)
        const type = feature.getGeometry()?.getType()
        if (type === 'Point' || type === 'MultiPoint') {
          return new Style({
            image: new CircleStyle({
              radius: isSelected ? 10 : 7,
              fill: new Fill({ color: isSelected ? '#f59e0b' : '#4f46e5' }),
              stroke: new Stroke({ color: '#fff', width: 2 }),
            }),
          })
        }
        return new Style({
          fill: new Fill({ color: isSelected ? 'rgba(245, 158, 11, 0.22)' : 'rgba(79, 70, 229, 0.15)' }),
          stroke: new Stroke({ color: isSelected ? '#f59e0b' : '#4f46e5', width: isSelected ? 3 : 2 }),
        })
      },
    })

    map.addLayer(newVectorLayer)
    vectorLayerRef.current = newVectorLayer

    const extent = vectorSource.getExtent()
    if (extent) {
      map.getView().fit(extent, {
        padding: [56, 56, 56, 56],
        maxZoom: 15,
        duration: 450,
      })
    }
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    // Check for GeoJSON file first
    const geojsonFile = files.find(file =>
      GEOJSON_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))
    )

    if (geojsonFile) {
      setIsProcessing(true)
      setStatusTone('neutral')
      setStatus(`Reading ${geojsonFile.name}...`)
      setLoadedFiles([geojsonFile.name])
      try {
        const text = await geojsonFile.text()
        const parsed = JSON.parse(text) as FeatureCollection
        if (!parsed.features || !Array.isArray(parsed.features)) {
          throw new Error('File does not contain a valid GeoJSON FeatureCollection')
        }
        displayGeoJSON(parsed)
        onDataLoaded?.(parsed, geojsonFile.name)
        setFeatureCount(parsed.features.length)
        setGeometrySummary(summarizeGeometry(parsed.features))
        setStatus(`Loaded ${parsed.features.length} feature${parsed.features.length === 1 ? '' : 's'} on the map.`)
        setStatusTone('success')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setFeatureCount(0)
        setGeometrySummary('Import failed')
        setStatus(`GeoJSON import failed: ${message}`)
        setStatusTone('error')
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // Check if there's a zip file
    const zipFile = files.find(file => file.name.toLowerCase().endsWith('.zip'))
    
    let filesToProcess: File[] = files
    
    if (zipFile) {
      setIsProcessing(true)
      setStatusTone('neutral')
      setStatus('Extracting zip file...')
      
      try {
        const zip = await JSZip.loadAsync(zipFile)
        const extractedFiles: File[] = []
        
        for (const [filename, zipEntry] of Object.entries(zip.files)) {
          if (!zipEntry.dir) {
            const lowerName = filename.toLowerCase()
            if (SHAPEFILE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
              const blob = await zipEntry.async('blob')
              const file = new File([blob], filename.split('/').pop() || filename, { type: 'application/octet-stream' })
              extractedFiles.push(file)
            }
          }
        }
        
        if (extractedFiles.length === 0) {
          setStatus('No shapefile components found in the zip file.')
          setStatusTone('error')
          setIsProcessing(false)
          return
        }
        
        filesToProcess = extractedFiles
        setStatus(`Extracted ${extractedFiles.length} file${extractedFiles.length === 1 ? '' : 's'} from zip...`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setStatus(`Failed to extract zip file: ${message}`)
        setStatusTone('error')
        setIsProcessing(false)
        return
      }
    }
    
    const shapefileFiles = filesToProcess.filter((file) => {
      const lowerName = file.name.toLowerCase()
      return SHAPEFILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
    })

    if (shapefileFiles.length === 0) {
      setStatus('No shapefile parts detected. Include at least the .shp file and any matching sidecar files.')
      setStatusTone('error')
      return
    }

    const hasShp = shapefileFiles.some((file) => file.name.toLowerCase().endsWith('.shp'))
    if (!hasShp) {
      setStatus('The import needs a .shp file. Add the matching .dbf, .shx, .prj, or .cpg files with it.')
      setStatusTone('error')
      return
    }

    // Check for required .shx file
    const baseName = shapefileFiles.find(f => f.name.toLowerCase().endsWith('.shp'))?.name.replace(/\.shp$/i, '')
    const hasShx = shapefileFiles.some((file) => 
      file.name.toLowerCase() === `${baseName?.toLowerCase()}.shx`
    )
    
    if (!hasShx) {
      setStatus('Missing required .shx file. Shapefiles need both .shp and .shx files (plus .dbf for attributes). Please select all files together.')
      setStatusTone('error')
      return
    }

    setIsProcessing(true);
    setStatusTone('neutral')
    setStatus(`Processing ${shapefileFiles.length} file${shapefileFiles.length === 1 ? '' : 's'}...`)
    setLoadedFiles(shapefileFiles.map((file) => file.name))

    try {
      const gdal = await GDALService.getInstance()
      const result = await gdal.processShapefile(shapefileFiles)

      if (result && result.features && result.features.length > 0) {
        displayGeoJSON(result)
        onDataLoaded?.(result, shapefileFiles.find(f => f.name.toLowerCase().endsWith('.shp'))?.name)
        setFeatureCount(result.features.length)
        setGeometrySummary(summarizeGeometry(result.features))
        setStatus(`Loaded ${result.features.length} feature${result.features.length === 1 ? '' : 's'} on the map.`)
        setStatusTone('success')
      } else {
        setFeatureCount(0)
        setGeometrySummary('No geometry')
        setStatus('The shapefile opened, but it did not return any renderable features.')
        setStatusTone('error')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setFeatureCount(0)
      setGeometrySummary('Import failed')
      setStatus(`Import failed: ${message}`)
      setStatusTone('error')
    } finally {
      setIsProcessing(false)
    }
  }, [displayGeoJSON, onDataLoaded])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)
    await processFiles(Array.from(e.dataTransfer.files))
  }, [processFiles])

  const handleFileSelection = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) {
      await processFiles(files)
    }
    e.target.value = ''
  }, [processFiles])

  const clearLayer = useCallback(() => {
    const map = mapInstance.current
    if (map && vectorLayerRef.current) {
      map.removeLayer(vectorLayerRef.current)
      vectorLayerRef.current = null
    }
    selectedFeatureRef.current = null
    setCurrentGeoJSON(null)

    setLoadedFiles([])
    setFeatureCount(0)
    setGeometrySummary('No data loaded')
    setStatus('Map cleared. Select or drop a shapefile or GeoJSON file to load another dataset.')
    setStatusTone('neutral')
  }, [])

  const [showDetails, setShowDetails] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [selectMode, setSelectMode] = useState(true)
  const selectModeRef = useRef(true)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const multiSelectModeRef = useRef(false)

  // Expose updateMap method to parent via ref
  useImperativeHandle(ref, () => ({
    updateMap: (data: FeatureCollection) => {
      displayGeoJSON(data)
      setFeatureCount(data.features.length)
      setGeometrySummary(summarizeGeometry(data.features))
      setStatus(`Processed: ${data.features.length} feature${data.features.length === 1 ? '' : 's'} on the map.`)
      setStatusTone('success')
    },
    getSelectedFeatures: () => {
      return Array.from(selectedFeaturesRef.current)
    },
    getSelectedIndices: () => {
      return Array.from(selectedFeaturesRef.current)
        .map(f => (f as any).get?.('_idx') as number)
        .filter(i => i !== undefined)
    },
    deleteSelectedFeature: () => {
      const feature = selectedFeatureRef.current
      const source = vectorLayerRef.current?.getSource()
      if (!source) return null

      const toDelete = selectedFeaturesRef.current.size > 0
        ? Array.from(selectedFeaturesRef.current)
        : feature ? [feature] : []

      if (toDelete.length === 0) return null

      for (const f of toDelete) {
        source.removeFeature(f as any)
      }
      selectedFeatureRef.current = null
      selectedFeaturesRef.current.clear()

      const format = new GeoJSON()
      const remainingFeatures = source.getFeatures()
      const updatedGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: remainingFeatures.map(f =>
          format.writeFeatureObject(f, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857',
          })
        )
      }
      setCurrentGeoJSON(updatedGeoJSON)
      setFeatureCount(updatedGeoJSON.features.length)
      setGeometrySummary(summarizeGeometry(updatedGeoJSON.features))
      setStatus(`Deleted feature. ${updatedGeoJSON.features.length} feature${updatedGeoJSON.features.length === 1 ? '' : 's'} remaining.`)
      setStatusTone('success')
      onFeatureClick?.({} as Record<string, unknown>, [0, 0])
      return updatedGeoJSON
    }
  }), [displayGeoJSON])

  return (
    <section className="map-workspace">
      <aside className="panel import-panel">
        <div className="panel-section">
          <p className="panel-kicker">Import</p>
          <h2>Shapefile / GeoJSON</h2>
        </div>

        <div
          className={`drop-zone${isDragging ? ' is-dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-zone-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="drop-zone-title">Drop files or click to browse</p>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".shp,.dbf,.shx,.prj,.cpg,.qpj,.shp.xml,.zip,.geojson,.json"
            multiple
            onChange={handleFileSelection}
          />
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Features</span>
            <strong>{featureCount}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Geometry</span>
            <strong>{geometrySummary}</strong>
          </div>
          {measures && measures.areaSqKm > 0 && (
            <div className="stat-card">
              <span className="stat-label">Total Area</span>
              <strong>{formatArea(measures.areaSqKm)}</strong>
            </div>
          )}
          {measures && measures.lengthKm > 0 && (
            <div className="stat-card">
              <span className="stat-label">Total Length</span>
              <strong>{formatDistance(measures.lengthKm)}</strong>
            </div>
          )}
        </div>

        {loadedFiles.length > 0 && (
          <div className="panel-section">
            <h3>Source</h3>
            <ul className="file-chip-list">
              {loadedFiles
                .filter(fileName => {
                  const lower = fileName.toLowerCase()
                  return lower.endsWith('.shp') || GEOJSON_EXTENSIONS.some(ext => lower.endsWith(ext))
                })
                .map((fileName) => (
                  <li key={fileName} className="file-chip">
                    {fileName}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {statusTone !== 'neutral' && (
          <div className={`status-card is-${statusTone}`}>
            <span className="status-label">{isProcessing ? 'Working' : statusTone === 'success' ? 'Ready' : 'Issue'}</span>
            <p>{status}</p>
          </div>
        )}

        <div className="action-group">
          <button
            type="button"
            className="secondary-button"
            onClick={clearLayer}
            disabled={featureCount === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} help
          </button>
        </div>

        {showDetails && (
          <div className="details-section">
            <p className="stat-label">File requirements</p>
            <ul className="guidance-list">
              <li>GeoJSON: drop a .geojson or .json file</li>
              <li>Shapefile required: .shp (geometry) + .shx (index)</li>
              <li>Recommended: .dbf (attributes)</li>
              <li>Optional: .prj (projection), .cpg (encoding)</li>
              <li>Or upload a single .zip file</li>
            </ul>
          </div>
        )}

        <div className="panel-attribution">
          Built by{' '}
          <a
            href="https://github.com/cpickett101"
            target="_blank"
            rel="noopener noreferrer"
          >
            Christopher Pickett
          </a>
          {' · '}
          <button className="about-inline-btn" onClick={() => setShowAbout(true)}>
            About
          </button>
        </div>

        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      </aside>

      <div className="map-stage">
        <div className="map-surface">
          {isProcessing && (
            <div className="processing-banner">Converting shapefile to map features...</div>
          )}

          {isDragging && (
            <div className="drop-zone-overlay">
              <div className="drop-zone-message">
                <strong>Drop files to import</strong>
                <span>Include the `.shp` and matching sidecar files together.</span>
              </div>
            </div>
          )}

          <div
            ref={mapRef}
            className={`map-canvas${isDragging ? ' drag-over' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />

          <div className="basemap-switcher">
            {BASEMAPS.map(bm => (
              <button
                key={bm.id}
                className={`basemap-btn${activeBasemap === bm.id ? ' is-active' : ''}`}
                onClick={() => switchBasemap(bm.id)}
                title={bm.label}
              >
                {bm.label}
              </button>
            ))}
          </div>

          {featureCount > 0 && (
            <div className="map-toolbar">
              <button
                className={`tool-btn${selectMode ? ' is-active' : ''}`}
                title={selectMode ? 'Deactivate select' : 'Select features'}
                onClick={toggleSelectMode}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
              </button>
              <button
                className={`tool-btn${multiSelectMode ? ' is-active' : ''}`}
                title={multiSelectMode ? 'Deactivate multi-select' : 'Multi-select features'}
                onClick={toggleMultiSelectMode}
              >
                <i className="fg fg-select-extent" style={{ fontSize: 20 }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
})

MapWithDropzone.displayName = 'MapWithDropzone'

export default MapWithDropzone
