import initGdalJs from 'gdal3.js'
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
