import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { storage, UnitSystem } from '../lib/storage'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(storage.getSettings().unitSystem)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleUnitSystemChange = (system: UnitSystem) => {
    setUnitSystem(system)
    storage.setSettings({ unitSystem: system })
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="about-logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
          </svg>
          <h2 id="settings-title">Settings</h2>
        </div>

        <div className="about-body">
          <h3>Measurement Units</h3>
          <select 
            className="processor-select"
            value={unitSystem}
            onChange={(e) => handleUnitSystemChange(e.target.value as UnitSystem)}
            style={{ marginTop: '12px' }}
          >
            <option value="metric">Metric (meters, kilometers)</option>
            <option value="imperial">Imperial (feet, miles)</option>
          </select>
        </div>
      </div>
    </div>,
    document.body
  )
}
