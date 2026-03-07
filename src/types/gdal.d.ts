declare module 'gdal3.js' {
  export interface GDALDataset {
    pointer: number
    path: string
    type: string
    width?: number
    height?: number
    bands?: GDALBand[]
    info?: any
    getFileList?(): string[]
  }

  export interface GDALBand {
    rasterSize: { x: number; y: number }
    pixels: ArrayBufferView
  }

  export interface GDALApi {
    open(files: File | FileList | string | string[], options?: string[], openOptions?: string[]): Promise<{ datasets: GDALDataset[]; errors: any[] }>
    close(dataset: GDALDataset): Promise<void>
    getInfo(dataset: GDALDataset): Promise<any>
    gdalwarp(dataset: GDALDataset, args?: string[], dest?: string | null): Promise<{ local: string; real: string; all: any[] }>
    gdal_translate(dataset: GDALDataset, args?: string[], dest?: string | null): Promise<{ local: string; real: string; all: any[] }>
    ogr2ogr(dataset: GDALDataset, args?: string[], dest?: string | null): Promise<{ local: string; real: string; all: any[] }>
    getFileBytes(file: { local: string } | string): Promise<Uint8Array>
    drivers: { raster: Record<string, any>; vector: Record<string, any> }
  }

  export interface InitOptions {
    useWorker?: boolean
    paths?: { wasm?: string; data?: string; js?: string }
    path?: string
    dest?: string
    env?: Record<string, string>
    logHandler?: (msg: string, type: string) => void
    errorHandler?: (msg: string, type: string) => void
  }

  function initGdalJs(options?: InitOptions): Promise<GDALApi>
  export default initGdalJs
}
