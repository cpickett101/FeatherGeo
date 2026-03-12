import React from 'react'

interface FeaturePopupProps {
  properties: Record<string, unknown>
  pixel: [number, number]
  onClose: () => void
  onDelete?: () => void
}

export function FeaturePopup({ properties, pixel, onClose, onDelete }: FeaturePopupProps) {
  const entries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined && v !== '')

  // Keep popup inside viewport with safe margins
  const popupW = Math.min(320, window.innerWidth - 24)
  const popupH = 360
  const left = Math.min(pixel[0] + 12, window.innerWidth - popupW - 8)
  const top = Math.min(pixel[1] + 12, window.innerHeight - popupH - 8)

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.max(8, left),
    top: Math.max(8, top),
    zIndex: 500,
  }

  return (
    <div className="feature-popup" style={style} role="dialog" aria-label="Feature attributes">
      <div className="feature-popup-header">
        <span className="feature-popup-title">Attributes</span>
        <div className="feature-popup-header-actions">
          {onDelete && (
            <button className="feature-popup-delete" onClick={onDelete} aria-label="Delete feature">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
          <button className="feature-popup-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>
      <div className="feature-popup-body">
        {entries.length === 0 ? (
          <p className="feature-popup-empty">No attributes</p>
        ) : (
          <table className="feature-popup-table">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
