import React, { useEffect, useMemo, useState } from 'react'
import { LoginPage } from './pages/LoginPage'
import { AdminLayout } from './shell/AdminLayout'
import { ProductBasesPage } from './pages/ProductBasesPage'
import { ProductsPage } from './pages/ProductsPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { api, AuthUser, clearAuth, getToken, setAuth } from './services/api'

type Route = 'product-bases' | 'products' | 'categories'

export function App() {
  const [route, setRoute] = useState<Route>('product-bases')
  const [token, setToken] = useState<string | null>(getToken())
  const [me, setMe] = useState<AuthUser | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const t = getToken()
    setToken(t)
    if (!t) return
    // no /me endpoint yet, so we decode from localStorage payload saved on login
    const saved = api.getSavedUser()
    if (saved) setMe(saved)
  }, [])

  const logout = () => {
    clearAuth()
    setToken(null)
    setMe(null)
    setError('')
  }

  if (!token) {
    return <LoginPage onLoggedIn={(t, user) => { setAuth(t, user); setToken(t); setMe(user); }} />
  }

  const meRole = (me as any)?.role ?? (me as any)?.rol;
  if (me && meRole !== 'ADMIN') {
    return (
      <div className="container">
        <div className="card" style={{ padding: 16 }}>
          <h1 className="h1">Acceso restringido</h1>
          <p className="h2">Este módulo es solo para ADMIN.</p>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={logout}>Salir</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AdminLayout
      route={route}
      onRouteChange={setRoute}
      user={me}
      onLogout={logout}
    >
      {route === 'product-bases' && <ProductBasesPage />}
      {route === 'products' && <ProductsPage />}
    </AdminLayout>
  )
}
