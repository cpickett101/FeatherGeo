import type { FeatureCollection } from 'geojson'
import LZString from 'lz-string'

export type UnitSystem = 'metric' | 'imperial'

export interface AppSettings {
  unitSystem: UnitSystem
}

const DEFAULT_SETTINGS: AppSettings = {
  unitSystem: 'metric'
}

const LAST_SESSION_KEY = 'feathergeo-last-session'

export interface LastSession {
  data: FeatureCollection
  fileName: string
  savedAt: number
}

interface CacheMeta {
  timestamp?: number
}

export const storage = {
  setGeoData<T>(key: string, data: T) {
    const compressed = LZString.compress(JSON.stringify(data))
    localStorage.setItem(`geo-${key}`, compressed)
  },

  getGeoData<T>(key: string): T | null {
    const compressed = localStorage.getItem(`geo-${key}`)
    return compressed ? JSON.parse(LZString.decompress(compressed) ?? 'null') as T | null : null
  },

  saveLastSession(data: FeatureCollection, fileName: string) {
    const session: LastSession = { data, fileName, savedAt: Date.now() }
    const compressed = LZString.compress(JSON.stringify(session))
    localStorage.setItem(LAST_SESSION_KEY, compressed)
  },

  loadLastSession(): LastSession | null {
    const compressed = localStorage.getItem(LAST_SESSION_KEY)
    if (!compressed) return null
    try {
      return JSON.parse(LZString.decompress(compressed) ?? 'null')
    } catch {
      return null
    }
  },

  clearLastSession() {
    localStorage.removeItem(LAST_SESSION_KEY)
  },

  // Settings management
  getSettings(): AppSettings {
    const stored = localStorage.getItem('app-settings')
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
  },

  setSettings(settings: Partial<AppSettings>) {
    const current = this.getSettings()
    const updated = { ...current, ...settings }
    localStorage.setItem('app-settings', JSON.stringify(updated))
  },

  // Cache management
  clearOldCaches(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('gdal-meta-')) {
        const meta = JSON.parse(localStorage.getItem(key) || '{}') as CacheMeta
        if (typeof meta.timestamp === 'number' && Date.now() - meta.timestamp > maxAgeMs) {
          localStorage.removeItem(key)
        }
      }
    })
  }
}
