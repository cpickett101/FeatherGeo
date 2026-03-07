import { useState, useRef } from 'react'
import { GDALService } from '../lib/gdalService'

type FileMode = 'geotiff' | 'shapefile'

export function GeoProcessor() {
  const [status, setStatus] = useState('idle')
  const [mode, setMode] = useState<FileMode>('geotiff')
  const shpFilesRef = useRef<File[]>([])

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
    <div>
      <div style={{ marginBottom: 8 }}>
        <label>
          <input type="radio" value="geotiff" checked={mode === 'geotiff'}
            onChange={() => setMode('geotiff')} /> GeoTIFF
        </label>
        {' '}
        <label>
          <input type="radio" value="shapefile" checked={mode === 'shapefile'}
            onChange={() => setMode('shapefile')} /> Shapefile
        </label>
      </div>

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
          <small style={{ display: 'block', color: '#666' }}>
            Select all shapefile components (.shp, .dbf, .shx, etc.) together
          </small>
        </div>
      )}

      <p>Status: {status}</p>
    </div>
  )
}

export default GeoProcessor
