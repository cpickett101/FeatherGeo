export interface GDALDataset {
  pointer: number
  path: string
  type: string
  width?: number
  height?: number
  info?: any
}
