import React, { useState } from 'react'
import { api, AuthUser } from '../services/api'

export function LoginPage({ onLoggedIn }: { onLoggedIn: (token: string, user: AuthUser) => void }) {
  const [usuario, setUsuario] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, user } = await api.login(usuario, password)
      onLoggedIn(token, user)
    } catch (err: any) {
      setError(err?.message || 'Error de login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ paddingTop: 46 }}>
      <div className="card" style={{ maxWidth: 520, margin: '0 auto', padding: 18 }}>
        <div className="row space">
          <div>
            <h1 className="h1">Dawson POS</h1>
            <p className="h2">Ingreso a Admin</p>
          </div>
          <span className="badge">v0.1</span>
        </div>

        <form onSubmit={submit} style={{ marginTop: 14 }} className="col">
          <div className="col">
            <label className="small">Usuario</label>
            <input className="input" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </div>
          <div className="col">
            <label className="small">Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {error && <div className="error">{error}</div>}

          <button className="btn primary" disabled={loading} type="submit">
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>

          <div className="small">
            API: <span style={{ fontFamily: 'var(--mono)' }}>{api.baseUrl}</span>
          </div>
        </form>
      </div>
    </div>
  )
}
