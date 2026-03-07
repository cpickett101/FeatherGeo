import gdalDataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url'
import gdalWasmUrl from 'gdal3.js/dist/package/gdal3WebAssembly.wasm?url'
import type { GDALDataset } from '../types/gdalTypes'

export type { GDALDataset }

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
            script.src = '/node_modules/gdal3.js/dist/package/gdal3.js'
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

  async processShapefile(files: File[]): Promise<GeoJSON.FeatureCollection> {
    // gdal3.js accepts an array of related shapefile files (.shp, .dbf, .shx, etc.)
    console.log('Processing shapefile with files:', files.map(f => f.name))
    
    const { datasets, errors } = await this.gdal.open(files)

    if (errors.length) {
      console.error('GDAL errors:', errors)
    }
    
    if (!datasets.length) {
      throw new Error(`Failed to open shapefile: ${errors[0]?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]
    console.log('Dataset opened:', dataset)

    // Convert each layer to GeoJSON using ogr2ogr via gdal3.js
    const result = await this.gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326'])
    console.log('ogr2ogr result:', result)
    
    await this.gdal.close(dataset)

    // The result contains file paths, we need to read the actual GeoJSON file
    if (result?.real) {
      const geojsonBytes = await this.gdal.getFileBytes(result.real)
      const text = new TextDecoder().decode(geojsonBytes)
      console.log('GeoJSON text:', text.substring(0, 500))
      
      try {
        const geojson = JSON.parse(text) as GeoJSON.FeatureCollection
        console.log('Parsed GeoJSON:', geojson)
        return geojson
      } catch (error) {
        console.error('Failed to parse GeoJSON:', error)
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
