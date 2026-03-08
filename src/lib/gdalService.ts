import type { GDALDataset } from '../types/gdalTypes'

export type { GDALDataset }

const gdalDataUrl = '/gdal/gdal3WebAssembly.data'
const gdalWasmUrl = '/gdal/gdal3WebAssembly.wasm'

const WASM_CACHE_KEY = 'gdal-wasm-cache'

// Declare the global initGdalJs function that will be loaded from the script
declare global {
  interface Window {
    initGdalJs: any
  }
}

export class GDALService {
  private static instance: GDALService
  private gdal!: any

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

  async exportToShapefile(geojson: GeoJSON.FeatureCollection, baseName = 'export'): Promise<Map<string, Uint8Array>> {
    const geojsonStr = JSON.stringify(geojson)
    const blob = new Blob([geojsonStr], { type: 'application/json' })
    const file = new File([blob], 'export.geojson', { type: 'application/json' })

    const { datasets, errors } = await this.gdal.open(file)
    if (!datasets.length) {
      throw new Error(`Failed to open GeoJSON for conversion: ${errors[0]?.message ?? 'unknown'}`)
    }

    const result = await this.gdal.ogr2ogr(datasets[0], ['-f', 'ESRI Shapefile'], `${baseName}.shp`)
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

  async processShapefile(files: File[]): Promise<GeoJSON.FeatureCollection> {
    const { datasets, errors } = await this.gdal.open(files)

    const realErrors = errors.filter((e: any) => e.no !== 0)
    if (realErrors.length) {
      console.error('GDAL errors:', realErrors)
    }
    
    if (!datasets.length) {
      throw new Error(`Failed to open shapefile: ${errors[0]?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]
    const result = await this.gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326'])
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
      throw new Error(`Failed to open file: ${errors[0]?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]

    // Cache dataset metadata in localStorage
    const cacheKey = `gdal-meta-${file.name}`
    localStorage.setItem(cacheKey, JSON.stringify({
      width: dataset.width,
      height: dataset.height,
      timestamp: Date.now()
    }))

    const info = await this.gdal.getInfo(dataset)
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

  private getBoundsFromInfo(info: any, dataset: GDALDataset): number[][] {
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
