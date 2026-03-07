import * as GdalModule from 'gdal3.js'
const initGdalJs = (GdalModule as any).default ?? GdalModule
import type { GDALDataset } from '../types/gdalTypes'

export type { GDALDataset }

const WASM_CACHE_KEY = 'gdal-wasm-cache'

export class GDALService {
  private static instance: GDALService
  private gdal!: any

  static async getInstance(): Promise<GDALService> {
    if (!this.instance) {
      const svc = new GDALService()
      svc.gdal = await initGdalJs({
        useWorker: false,
        paths: { wasm: 'node_modules/gdal3.js/dist/package/gdal3WebAssembly.wasm',
                 data: 'node_modules/gdal3.js/dist/package/gdal3WebAssembly.data' }
      })
      this.instance = svc
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
    const { datasets, errors } = await this.gdal.open(files)

    if (errors.length || !datasets.length) {
      throw new Error(`Failed to open shapefile: ${errors[0]?.message ?? 'unknown error'}`)
    }

    const dataset: GDALDataset = datasets[0]
    const features: GeoJSON.Feature[] = []

    // Convert each layer to GeoJSON using ogr2ogr via gdal3.js
    const result = await this.gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326'])
    await this.gdal.close(dataset)

    if (result?.output) {
      const text = new TextDecoder().decode(result.output)
      try {
        return JSON.parse(text) as GeoJSON.FeatureCollection
      } catch {
        throw new Error('Failed to parse GeoJSON output from shapefile')
      }
    }

    return { type: 'FeatureCollection', features }
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
