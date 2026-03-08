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
  data: any
  fileName: string
  savedAt: number
}

export const storage = {
  setGeoData(key: string, data: any) {
    const compressed = LZString.compress(JSON.stringify(data))
    localStorage.setItem(`geo-${key}`, compressed)
  },

  getGeoData(key: string): any | null {
    const compressed = localStorage.getItem(`geo-${key}`)
    return compressed ? JSON.parse(LZString.decompress(compressed) ?? 'null') : null
  },

  saveLastSession(data: any, fileName: string) {
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
        const meta = JSON.parse(localStorage.getItem(key) || '{}')
        if (Date.now() - meta.timestamp > maxAgeMs) {
          localStorage.removeItem(key)
        }
      }
    })
  }
}
