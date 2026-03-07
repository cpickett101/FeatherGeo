import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Map as OLMap, View } from 'ol'
import { GeoJSON } from 'ol/format'
import VectorLayer from 'ol/layer/Vector'
import TileLayer from 'ol/layer/Tile'
import VectorSource from 'ol/source/Vector'
import OSM from 'ol/source/OSM'
import { Fill, Stroke, Style } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import type { FeatureCollection } from 'geojson'
import { GDALService } from '../lib/gdalService'

interface MapWithDropzoneProps {
  onFilesProcessed?: (features: GeoJSON.Feature[]) => void
}

type ImportStatusTone = 'neutral' | 'success' | 'error'

const SHAPEFILE_EXTENSIONS = ['.shp', '.dbf', '.shx', '.prj', '.cpg', '.qpj', '.shp.xml']

const MapWithDropzone: React.FC<MapWithDropzoneProps> = ({ onFilesProcessed }) => {
  const mapRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapInstance = useRef<OLMap | null>(null)
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState('Select or drop shapefile components to render them on the map.')
  const [statusTone, setStatusTone] = useState<ImportStatusTone>('neutral')
  const [loadedFiles, setLoadedFiles] = useState<string[]>([])
  const [featureCount, setFeatureCount] = useState(0)
  const [geometrySummary, setGeometrySummary] = useState<string>('No data loaded')

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new OLMap({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM()
        })
      ],
      view: new View({
        center: fromLonLat([0, 0]),
        zoom: 2
      })
    });

    mapInstance.current = map

    return () => {
      if (map) {
        map.setTarget(undefined)
      }
    }
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

    if (vectorLayerRef.current) {
      map.removeLayer(vectorLayerRef.current)
    }

    const vectorSource = new VectorSource({
      features: new GeoJSON().readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }),
    })

    const newVectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        fill: new Fill({
          color: 'rgba(14, 116, 144, 0.18)',
        }),
        stroke: new Stroke({
          color: '#0f766e',
          width: 2,
        }),
      }),
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
    const shapefileFiles = files.filter((file) => {
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
        onFilesProcessed?.(result.features)
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
  }, [displayGeoJSON, onFilesProcessed])

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

    setLoadedFiles([])
    setFeatureCount(0)
    setGeometrySummary('No data loaded')
    setStatus('Map cleared. Select or drop shapefile components to load another dataset.')
    setStatusTone('neutral')
  }, [])

  return (
    <section className="map-workspace">
      <aside className="panel import-panel">
        <div className="panel-section">
          <p className="panel-kicker">Shapefile Import</p>
          <h2>Load vector data</h2>
          <p className="panel-copy">
            Drag shapefile components to the drop zone or click to browse. Feather Geo converts them to GeoJSON and zooms to the result.
          </p>
        </div>

        <div
          className={`drop-zone${isDragging ? ' is-dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="drop-zone-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="drop-zone-title">Drop shapefile components here</p>
          <p className="drop-zone-hint">or click to browse files</p>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".shp,.dbf,.shx,.prj,.cpg,.qpj,.shp.xml"
            multiple
            onChange={handleFileSelection}
          />
          <button
            type="button"
            className="drop-zone-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
          >
            {isProcessing ? 'Importing...' : 'Browse files'}
          </button>
        </div>

        <div className="panel-section action-group">
          <button
            type="button"
            className="secondary-button"
            onClick={clearLayer}
            disabled={isProcessing && featureCount === 0}
          >
            Clear map
          </button>
        </div>

        <div className={`status-card is-${statusTone}`}>
          <span className="status-label">{isProcessing ? 'Working' : statusTone === 'success' ? 'Ready' : statusTone === 'error' ? 'Issue' : 'Status'}</span>
          <p>{status}</p>
        </div>

        <div className="panel-section stats-grid">
          <div className="stat-card">
            <span className="stat-label">Features</span>
            <strong>{featureCount}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Geometry</span>
            <strong>{geometrySummary}</strong>
          </div>
        </div>

        <div className="panel-section">
          <h3>Included files</h3>
          {loadedFiles.length > 0 ? (
            <ul className="file-chip-list">
              {loadedFiles.map((fileName) => (
                <li key={fileName} className="file-chip">
                  {fileName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No files selected yet.</p>
          )}
        </div>

        <div className="panel-section">
          <h3>What to include</h3>
          <ul className="guidance-list">
            <li>Required: the `.shp` file (geometry).</li>
            <li>Required: the `.shx` file (index).</li>
            <li>Recommended: matching `.dbf` file (attributes).</li>
            <li>Optional: `.prj`, `.cpg`, `.qpj`, and `.shp.xml` for projection and metadata.</li>
            <li>Tip: Select all files with the same base name together (e.g., roads.shp, roads.shx, roads.dbf).</li>
          </ul>
        </div>
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
        </div>
      </div>
    </section>
  )
}

export default MapWithDropzone
