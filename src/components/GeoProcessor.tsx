import { useState, useRef, useEffect } from 'react'
import { GDALService } from '../lib/gdalService'

type FileMode = 'geotiff' | 'shapefile'

interface GeoProcessorProps {
  onClose: () => void
}

export function GeoProcessor({ onClose }: GeoProcessorProps) {
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState<FileMode>('geotiff')
  const shpFilesRef = useRef<File[]>([])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const process = async (files: File[]) => {
    setStatus('processing')
    try {
      const gdal = await GDALService.getInstance()
      const result = mode === 'shapefile'
        ? await gdal.processShapefile(files)
        : await gdal.processGeoTIFF(files[0])

      localStorage.setItem('last-processed', JSON.stringify(result))
      setStatus(`complete — ${result.features.length} feature(s)`)
    } catch (e: any) {
      setStatus(`error: ${e.message}`)
    }
  }

  const handleGeoTIFF = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) process([file])
  }

  // Shapefiles require .shp + .dbf + .shx at minimum
  const handleShapefile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      shpFilesRef.current = files
      process(files)
    }
  }

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
          <div className="processor-mode-selector">
            <label>
              <input 
                type="radio" 
                value="geotiff" 
                checked={mode === 'geotiff'}
                onChange={() => setMode('geotiff')} 
              /> GeoTIFF
            </label>
            <label>
              <input 
                type="radio" 
                value="shapefile" 
                checked={mode === 'shapefile'}
                onChange={() => setMode('shapefile')} 
              /> Shapefile
            </label>
          </div>

          <div className="processor-file-input">
            {mode === 'geotiff' ? (
              <input type="file" accept=".tif,.tiff" onChange={handleGeoTIFF} />
            ) : (
              <div>
                <input
                  type="file"
                  accept=".shp,.dbf,.shx,.prj,.cpg,.qpj"
                  multiple
                  onChange={handleShapefile}
                />
                <small className="processor-hint">
                  Select all shapefile components (.shp, .dbf, .shx, etc.) together
                </small>
              </div>
            )}
          </div>

          <div className="processor-status">
            <strong>Status:</strong> {status}
          </div>
        </div>
      </div>
    </>
  )
}

export default GeoProcessor
