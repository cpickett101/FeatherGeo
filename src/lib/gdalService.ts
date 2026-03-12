import type { GDALApi, InitOptions } from 'gdal3.js'
import type { GDALDataset } from '../types/gdalTypes'

export type { GDALDataset }

interface GDALError {
  no?: number
  message?: string
}

interface GDALInfoCorners {
  corners?: number[][]
}

const gdalDataUrl = '/gdal/gdal3WebAssembly.data'
const gdalWasmUrl = '/gdal/gdal3WebAssembly.wasm'

const WASM_CACHE_KEY = 'gdal-wasm-cache'

// Declare the global initGdalJs function that will be loaded from the script
declare global {
  interface Window {
    initGdalJs?: (options?: InitOptions) => Promise<GDALApi>
  }
}

export class GDALService {
  private static instance: GDALService
  private gdal!: GDALApi

  static async getInstance(): Promise<GDALService> {
    if (!this.instance) {
      const svc = new GDALService()
      
      try {
        // Load GDAL as a script tag since ES module import isn't working
        if (!window.initGdalJs) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = '/gdal/gdal3.js'
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load GDAL script'))
            document.head.appendChild(script)
          })
        }

        if (typeof window.initGdalJs !== 'function') {
          throw new Error('GDAL script loaded but initGdalJs is not available')
        }

        svc.gdal = await window.initGdalJs({
          useWorker: false,
          paths: {
            wasm: gdalWasmUrl,
            data: gdalDataUrl,
          },
        })
        this.instance = svc
      } catch (error) {
        console.error('Failed to initialize GDAL:', error)
        throw error
      }
    }
    return this.instance
  }

  private static async loadWasmFromCache(): Promise<ArrayBuffer | null> {
    try {
      const cached = localStorage.getItem(WASM_CACHE_KEY)
      if (cached) {
        const binaryString = atob(cached)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        return bytes.buffer
      }
    } catch (e) {
      console.warn('WASM cache read failed:', e)
    }
    return null
  }

  async reprojectGeoJSON(geojson: GeoJSON.FeatureCollection, sourceCrs: string): Promise<GeoJSON.FeatureCollection> {
    // Strip any embedded CRS so GDAL uses our explicit -s_srs instead
    const { crs: _crs, ...rest } = geojson as GeoJSON.FeatureCollection & { crs?: unknown }
    const geojsonStr = JSON.stringify(rest)
    const blob = new Blob([geojsonStr], { type: 'application/json' })
    const file = new File([blob], 'input.geojson', { type: 'application/json' })

    const { datasets, errors } = await this.gdal.open(file)
    if (!datasets.length) {
      throw new Error(`Failed to open GeoJSON for reprojection: ${(errors[0] as GDALError)?.message ?? 'unknown'}`)
    }

    const result = await this.gdal.ogr2ogr(datasets[0], [
      '-f', 'GeoJSON',
      '-s_srs', `EPSG:${sourceCrs}`,
      '-t_srs', 'EPSG:4326',
    ])
    await this.gdal.close(datasets[0])

    if (result?.real) {
      const bytes = await this.gdal.getFileBytes(result.real)
      const text = new TextDecoder().decode(bytes)
      try {
        return JSON.parse(text) as GeoJSON.FeatureCollection
      } catch {
        throw new Error('Failed to parse reprojected GeoJSON')
      }
    }
    throw new Error('No output from GeoJSON reprojection')
  }

  async exportToGeoJSON(geojson: GeoJSON.FeatureCollection, targetCrs: string): Promise<GeoJSON.FeatureCollection> {
    const { crs: _crs, ...rest } = geojson as GeoJSON.FeatureCollection & { crs?: unknown }
    const blob = new Blob([JSON.stringify(rest)], { type: 'application/json' })
    const file = new File([blob], 'export.geojson', { type: 'application/json' })

    const { datasets, errors } = await this.gdal.open(file)
    if (!datasets.length) {
      throw new Error(`Failed to open GeoJSON for export: ${(errors[0] as GDALError)?.message ?? 'unknown'}`)
    }

    const result = await this.gdal.ogr2ogr(datasets[0], [
      '-f', 'GeoJSON',
      '-s_srs', 'EPSG:4326',
      '-t_srs', `EPSG:${targetCrs}`,
    ])
    await this.gdal.close(datasets[0])

    if (result?.real) {
      const bytes = await this.gdal.getFileBytes(result.real)
      const text = new TextDecoder().decode(bytes)
      try {
        return JSON.parse(text) as GeoJSON.FeatureCollection
      } catch {
        throw new Error('Failed to parse reprojected GeoJSON output')
      }
    }
    throw new Error('No output from GeoJSON export reprojection')
  }

  async exportToShapefile(geojson: GeoJSON.FeatureCollection, baseName = 'export', targetCrs?: string): Promise<Map<string, Uint8Array>> {
    const { crs: _crs, ...rest } = geojson as GeoJSON.FeatureCollection & { crs?: unknown }
    const geojsonStr = JSON.stringify(rest)
    const blob = new Blob([geojsonStr], { type: 'application/json' })
    const file = new File([blob], 'export.geojson', { type: 'application/json' })

    const { datasets, errors } = await this.gdal.open(file)
    if (!datasets.length) {
      throw new Error(`Failed to open GeoJSON for conversion: ${(errors[0] as GDALError)?.message ?? 'unknown'}`)
    }

    const ogr2ogrArgs = ['-f', 'ESRI Shapefile']
    if (targetCrs) {
      ogr2ogrArgs.push('-s_srs', 'EPSG:4326', '-t_srs', `EPSG:${targetCrs}`)
    }

    const result = await this.gdal.ogr2ogr(datasets[0], ogr2ogrArgs, `${baseName}.shp`)
    await this.gdal.close(datasets[0])

    const files = new Map<string, Uint8Array>()

    const shpPath: string | undefined = result?.real
    if (shpPath) {
      const pathBase = shpPath.replace(/\.shp$/i, '')
      const extensions = ['.shp', '.shx', '.dbf', '.prj', '.cpg']

      for (const ext of extensions) {
        const filePath = pathBase + ext
        try {
          const bytes = await this.gdal.getFileBytes(filePath)
          if (bytes && bytes.byteLength > 0) {
            files.set(baseName + ext, new Uint8Array(bytes))
          }
        } catch {
          // optional sidecar files may not exist
        }
      }
    }

    if (files.size === 0) {
      throw new Error('No output generated from shapefile conversion')
    }

    return files
  }

  async exportToKMZ(geojson: GeoJSON.FeatureCollection, baseName = 'export'): Promise<Uint8Array> {
    const JSZip = (await import('jszip')).default

    const kml = geojsonToKML(geojson, baseName)
    const zip = new JSZip()
    zip.file('doc.kml', kml)
    const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    return blob
  }

  async processKML(file: File, sourceCrs?: string): Promise<GeoJSON.FeatureCollection> {
    const { datasets, errors } = await this.gdal.open(file)
    const realErrors = errors.filter((e): e is GDALError => (e as GDALError).no !== 0)
    if (realErrors.length) console.error('GDAL errors:', realErrors)
    if (!datasets.length) {
      throw new Error(`Failed to open KML: ${(errors[0] as GDALError)?.message ?? 'unknown error'}`)
    }
    const dataset: GDALDataset = datasets[0]
    const ogr2ogrArgs = [
      '-f', 'GeoJSON',
      '-t_srs', 'EPSG:4326',
      '-skipfailures',
      ...(sourceCrs ? ['-s_srs', `EPSG:${sourceCrs}`] : []),
    ]
    const result = await this.gdal.ogr2ogr(dataset, ogr2ogrArgs)
    await this.gdal.close(dataset)
    if (result?.real) {
      const bytes = await this.gdal.getFileBytes(result.real)
      const text = new TextDecoder().decode(bytes)
      try {
        const fc = JSON.parse(text) as GeoJSON.FeatureCollection
        // Filter out features with null/empty geometry (label layers produce these)
        fc.features = fc.features.filter(f => f.geometry != null)
        return fc
      } catch {
        throw new Error('Failed to parse GeoJSON output from KML')
      }
    }
    throw new Error('No output file generated from KML')
  }

  async processShapefile(files: File[], sourceCrs?: string): Promise<GeoJSON.FeatureCollection> {
    const dataTransfer = new DataTransfer()
    for (const file of files) {
      dataTransfer.items.add(file)
    }

    const { datasets, errors } = await this.gdal.open(dataTransfer.files)

    const realErrors = errors.filter((e): e is GDALError => (e as GDALError).no !== 0)
    if (realErrors.length) {
      console.error('GDAL errors:', realErrors)
    }
    
    if (!datasets.length) {
      throw new Error(`Failed to open shapefile: ${(errors[0] as GDALError)?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]
    const result = await this.gdal.ogr2ogr(dataset, [
      '-f', 'GeoJSON',
      '-t_srs', 'EPSG:4326',
      ...(sourceCrs ? ['-s_srs', `EPSG:${sourceCrs}`] : []),
    ])
    await this.gdal.close(dataset)

    if (result?.real) {
      const geojsonBytes = await this.gdal.getFileBytes(result.real)
      const text = new TextDecoder().decode(geojsonBytes)
      try {
        return JSON.parse(text) as GeoJSON.FeatureCollection
      } catch {
        throw new Error('Failed to parse GeoJSON output from shapefile')
      }
    }

    throw new Error('No output file generated from ogr2ogr')
  }

  async processGeoTIFF(file: File): Promise<GeoJSON.FeatureCollection> {
    const { datasets, errors } = await this.gdal.open(file)

    if (errors.length || !datasets.length) {
      throw new Error(`Failed to open file: ${(errors[0] as GDALError)?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]

    // Cache dataset metadata in localStorage
    const cacheKey = `gdal-meta-${file.name}`
    localStorage.setItem(cacheKey, JSON.stringify({
      width: dataset.width,
      height: dataset.height,
      timestamp: Date.now()
    }))

    const info = await this.gdal.getInfo(dataset) as (GDALInfoCorners & { bandCount?: number }) | undefined
    const bounds = this.getBoundsFromInfo(info, dataset)

    await this.gdal.close(dataset)

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [bounds]
        },
        properties: {
          bands: info?.bandCount ?? 0,
          cached: true
        }
      }]
    }
  }

  private getBoundsFromInfo(info: GDALInfoCorners | undefined, dataset: GDALDataset): number[][] {
    // Use corners from gdalinfo if available, otherwise fall back to pixel dimensions
    if (info?.corners) {
      const c = info.corners
      return [c[0], c[1], c[2], c[3], c[0]]
    }
    const w = dataset.width ?? 0
    const h = dataset.height ?? 0
    return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
  }
}

function coordsToKML(coords: number[][]): string {
  return coords.map(c => `${c[0]},${c[1]}${c[2] != null ? `,${c[2]}` : ''}`).join(' ')
}

function geometryToKML(geom: GeoJSON.Geometry): string {
  switch (geom.type) {
    case 'Point':
      return `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]}</coordinates></Point>`
    case 'MultiPoint':
      return geom.coordinates.map(c => `<Point><coordinates>${c[0]},${c[1]}</coordinates></Point>`).join('')
    case 'LineString':
      return `<LineString><coordinates>${coordsToKML(geom.coordinates)}</coordinates></LineString>`
    case 'MultiLineString':
      return geom.coordinates.map(c => `<LineString><coordinates>${coordsToKML(c)}</coordinates></LineString>`).join('')
    case 'Polygon':
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKML(geom.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>${
        geom.coordinates.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${coordsToKML(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')
      }</Polygon>`
    case 'MultiPolygon':
      return `<MultiGeometry>${geom.coordinates.map(poly =>
        `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKML(poly[0])}</coordinates></LinearRing></outerBoundaryIs>${
          poly.slice(1).map(r => `<innerBoundaryIs><LinearRing><coordinates>${coordsToKML(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')
        }</Polygon>`
      ).join('')}</MultiGeometry>`
    case 'GeometryCollection':
      return `<MultiGeometry>${geom.geometries.map(geometryToKML).join('')}</MultiGeometry>`
    default:
      return ''
  }
}

function geojsonToKML(fc: GeoJSON.FeatureCollection, name: string): string {
  const styles = `
  <Style id="poly-style">
    <LineStyle><color>ffE54F46</color><width>2</width></LineStyle>
    <PolyStyle><color>26E54F46</color></PolyStyle>
  </Style>
  <Style id="line-style">
    <LineStyle><color>ffE54F46</color><width>2</width></LineStyle>
    <PolyStyle><fill>0</fill></PolyStyle>
  </Style>
  <Style id="point-style">
    <IconStyle>
      <color>ffE54F46</color>
      <scale>0.8</scale>
      <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
    </IconStyle>
  </Style>`

  const placemarks = fc.features.map((f, i) => {
    const label = (f.properties?.name ?? f.properties?.NAME ?? f.properties?.id ?? `Feature ${i + 1}`) as string
    const desc = f.properties
      ? Object.entries(f.properties).map(([k, v]) => `${k}: ${v}`).join('\n')
      : ''
    const geomKML = f.geometry ? geometryToKML(f.geometry) : ''
    const geomType = f.geometry?.type ?? ''
    const styleUrl = geomType.includes('Point') ? '#point-style'
      : geomType.includes('Line') ? '#line-style'
      : '#poly-style'
    return `<Placemark><name>${label}</name><description><![CDATA[${desc}]]></description><styleUrl>${styleUrl}</styleUrl>${geomKML}</Placemark>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>${name}</name>
${styles}
${placemarks}
</Document>
</kml>`
}
