import { storage, UnitSystem } from './storage'

const KM_TO_FEET = 3280.84
const SQ_KM_TO_SQ_FEET = 10763910.4

export function formatDistance(km: number, unitSystem?: UnitSystem): string {
  const system = unitSystem ?? storage.getSettings().unitSystem
  
  if (system === 'imperial') {
    const feet = km * KM_TO_FEET
    if (feet >= 5280) {
      const miles = feet / 5280
      return `${miles.toFixed(2)} mi`
    }
    return `${feet.toFixed(0)} ft`
  }
  
  // Metric
  if (km >= 1) {
    return `${km.toFixed(2)} km`
  }
  return `${(km * 1000).toFixed(0)} m`
}

export function formatArea(sqKm: number, unitSystem?: UnitSystem): string {
  const system = unitSystem ?? storage.getSettings().unitSystem
  
  if (system === 'imperial') {
    const sqFeet = sqKm * SQ_KM_TO_SQ_FEET
    if (sqFeet >= 43560) {
      const acres = sqFeet / 43560
      if (acres >= 640) {
        const sqMiles = acres / 640
        return `${sqMiles.toFixed(2)} mi²`
      }
      return `${acres.toFixed(2)} ac`
    }
    return `${sqFeet.toFixed(0)} ft²`
  }
  
  // Metric
  if (sqKm >= 1) {
    return `${sqKm.toFixed(2)} km²`
  }
  return `${(sqKm * 1_000_000).toFixed(0)} m²`
}

export function getDistanceUnit(unitSystem?: UnitSystem): string {
  const system = unitSystem ?? storage.getSettings().unitSystem
  return system === 'imperial' ? 'mi' : 'km'
}

export function convertDistanceToKm(value: number, unitSystem?: UnitSystem): number {
  const system = unitSystem ?? storage.getSettings().unitSystem
  return system === 'imperial' ? value * 1.60934 : value
}
