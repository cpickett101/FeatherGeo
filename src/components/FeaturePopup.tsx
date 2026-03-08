import React from 'react'

interface FeaturePopupProps {
  properties: Record<string, unknown>
  pixel: [number, number]
  onClose: () => void
}

export function FeaturePopup({ properties, pixel, onClose }: FeaturePopupProps) {
  const entries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined && v !== '')

  // Keep popup inside viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: pixel[0] + 12,
    top: pixel[1] + 12,
    zIndex: 500,
  }

  return (
    <div className="feature-popup" style={style} role="dialog" aria-label="Feature attributes">
      <div className="feature-popup-header">
        <span className="feature-popup-title">Attributes</span>
        <button className="feature-popup-close" onClick={onClose} aria-label="Close">×</button>
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
