import { useState } from 'react'
import { GDALService } from '../lib/gdalService'

export function GeoProcessor() {
  const [status, setStatus] = useState('idle')

  const handleFile = async (file: File) => {
    setStatus('processing')
    const gdal = await GDALService.getInstance()
    const result = await gdal.processGeoTIFF(file)

    // Store result in localStorage
    localStorage.setItem('last-processed', JSON.stringify(result))
    setStatus('complete')
  }

  return (
    <div>
      <input
        type="file"
        accept=".tif,.tiff"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <p>Status: {status}</p>
    </div>
  )
}
