import { useState, useEffect } from 'react'
import type { Feature, FeatureCollection, Polygon, MultiPolygon, GeoJsonProperties } from 'geojson'
import * as turf from '@turf/turf'

function isPolygonFeature(
  feature: Feature<Polygon | MultiPolygon, GeoJsonProperties> | null | undefined
): feature is Feature<Polygon | MultiPolygon, GeoJsonProperties> {
  return feature != null
}

function isPolygonOnlyFeature(
  feature: Feature<Polygon, GeoJsonProperties> | null | undefined
): feature is Feature<Polygon, GeoJsonProperties> {
  return feature != null
}

type OperationType = 'buffer' | 'simplify' | 'centroid' | 'convexHull' | 'bbox'

interface GeoProcessorProps {
  onClose: () => void
  currentData: FeatureCollection | null
  onDataProcessed: (data: FeatureCollection) => void
}

export function GeoProcessor({ onClose, currentData, onDataProcessed }: GeoProcessorProps) {
  const [status, setStatus] = useState('idle')
  const [operation, setOperation] = useState<OperationType>('buffer')
  const [bufferDistance, setBufferDistance] = useState(1)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.01)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const processOperation = () => {
    if (!currentData || !currentData.features.length) {
      setStatus('No data loaded. Import a shapefile first.')
      return
    }

    setStatus('processing')
    
    try {
      let result: FeatureCollection

      switch (operation) {
        case 'buffer': {
          const buffered = currentData.features.map(feature => {
            try {
              return turf.buffer(feature, bufferDistance, { units: 'kilometers' })
            } catch (e) {
              return null
            }
          }).filter(isPolygonFeature)
          result = turf.featureCollection(buffered)
          break
        }

        case 'simplify': {
          const simplified = currentData.features.map(feature => {
            try {
              return turf.simplify(feature, { tolerance: simplifyTolerance, highQuality: false })
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
          }).filter(f => f !== null)
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
          }).filter(isPolygonOnlyFeature)
          result = turf.featureCollection(boxes)
          break
        }

        default:
          result = currentData
      }

      onDataProcessed(result)
      setStatus(`complete — ${result.features.length} feature(s) generated`)
    } catch (e: any) {
      setStatus(`error: ${e.message}`)
    }
  }

  const hasData = currentData && currentData.features.length > 0

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="processor-title">
        <div className="modal-header">
          <h2 id="processor-title">Geo Processor</h2>
          <button 
            className="modal-close"
            onClick={onClose}
            aria-label="Close processor"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {!hasData && (
            <div className="processor-status">
              <strong>No data loaded</strong>
              Import a shapefile first to use processing operations.
            </div>
          )}

          {hasData && (
            <>
              <div className="processor-status">
                <strong>Current data:</strong> {currentData.features.length} feature(s) loaded
              </div>

              <div className="processor-section">
                <label className="processor-label">Operation</label>
                <select 
                  className="processor-select"
                  value={operation} 
                  onChange={(e) => setOperation(e.target.value as OperationType)}
                >
                  <option value="buffer">Buffer</option>
                  <option value="simplify">Simplify</option>
                  <option value="centroid">Centroid</option>
                  <option value="convexHull">Convex Hull</option>
                  <option value="bbox">Bounding Box</option>
                </select>
              </div>

              {operation === 'buffer' && (
                <div className="processor-section">
                  <label className="processor-label">
                    Buffer Distance (km)
                    <input
                      type="number"
                      className="processor-input"
                      value={bufferDistance}
                      onChange={(e) => setBufferDistance(Number(e.target.value))}
                      min="0.1"
                      step="0.1"
                    />
                  </label>
                </div>
              )}

              {operation === 'simplify' && (
                <div className="processor-section">
                  <label className="processor-label">
                    Tolerance
                    <input
                      type="number"
                      className="processor-input"
                      value={simplifyTolerance}
                      onChange={(e) => setSimplifyTolerance(Number(e.target.value))}
                      min="0.001"
                      step="0.001"
                    />
                  </label>
                  <small className="processor-hint">
                    Lower values preserve more detail
                  </small>
                </div>
              )}

              <button
                type="button"
                className="primary-button"
                onClick={processOperation}
                style={{ width: '100%' }}
              >
                Apply {operation}
              </button>

              <div className="processor-status">
                <strong>Status:</strong> {status}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default GeoProcessor
