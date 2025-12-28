import React from 'react'

type Props = {
  children: React.ReactNode
  route: 'product-bases' | 'products' | 'categories'
  onRouteChange: (r: 'product-bases' | 'products' | 'categories') => void
  user: any
  onLogout: () => void
}

export function AdminLayout({ children, route, onRouteChange, user, onLogout }: Props) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="row space">
            <div className="col" style={{ gap: 2 }}>
              <div style={{ fontWeight: 700, letterSpacing: .3 }}>DAWSON</div>
              <div className="small">Admin</div>
            </div>
            <span className="badge on">Online</span>
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            Usuario: <span style={{ color: 'var(--text)' }}>{user?.usuario || 'admin'}</span>
          </div>
        </div>

        <nav className="nav">
          <a href="#" className={route==='product-bases' ? 'active' : ''} onClick={(e) => { e.preventDefault(); onRouteChange('product-bases') }}>
            Productos base (stock)
          </a>
          <a href="#" className={route==='products' ? 'active' : ''} onClick={(e) => { e.preventDefault(); onRouteChange('products') }}>
            Presentaciones (POS)
          </a>
        </nav>

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={onLogout} style={{ width: '100%' }}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main>
        <div className="topbar">
          <div>
            <h1 className="h1">{route === 'product-bases' ? 'Productos base' : route === 'products' ? 'Presentaciones' : 'Categorías'}</h1>
            <p className="h2">{route === 'product-bases' ? 'Stock real (decimales) y estado activo' : 'Items vendibles en POS (1L, 5L, marca, etc.)'}</p>
          </div>
          <div className="row">
            <span className="badge">{new Date().toLocaleDateString('es-AR')}</span>
          </div>
        </div>
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  )
}
