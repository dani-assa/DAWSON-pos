import React, { useEffect } from 'react'

export function Modal({ title, onClose, children }: { title: string, onClose: () => void, children: React.ReactNode }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card modal">
        <div className="row space" style={{ marginBottom: 10 }}>
          <div>
            <div className="h1">{title}</div>
            <div className="small">ADMIN</div>
          </div>
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  )
}
