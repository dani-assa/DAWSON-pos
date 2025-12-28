import React, { useEffect, useMemo, useState } from 'react'
import { api, Category } from '../services/api'
import { Modal } from '../widgets/Modal'

export function CategoriesPage() {
  const [items, setItems] = useState<Category[]>([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [nombre, setNombre] = useState('')
  const [orden, setOrden] = useState<number>(0)
  const [color, setColor] = useState<string>('')
  const [activo, setActivo] = useState<boolean>(true)

  async function refresh() {
    setLoading(true); setError('')
    try {
      const res = await api.listCategories(includeInactive)
      setItems(res.items || [])
    } catch (e: any) {
      setError(e?.message || 'Error al listar categorías')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [includeInactive])

  function startCreate() {
    setEditing(null)
    setNombre('')
    setOrden(0)
    setColor('')
    setActivo(true)
    setOpen(true)
  }

  function startEdit(c: Category) {
    setEditing(c)
    setNombre(c.nombre || '')
    setOrden(c.orden ?? 0)
    setColor((c.color as any) || '')
    setActivo(!!c.activo)
    setOpen(true)
  }

  async function save() {
    setError('')
    try {
      if (editing) {
        await api.updateCategory(editing.categoryId, { nombre, orden, color: color || null, activo })
      } else {
        await api.createCategory({ nombre, orden, color: color || null, activo })
      }
      setOpen(false)
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar')
    }
  }

  async function remove(c: Category) {
    const ok = window.confirm(`¿Eliminar la categoría "${c.nombre}"?\n\nSi está en uso, se desactivará (soft delete).`)
    if (!ok) return
    setError('')
    try {
      await api.deleteCategory(c.categoryId)
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar')
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row space">
          <div className="col">
            <div className="h2">Categorías</div>
            <div className="small">Administración de categorías (para dropdown y consistencia).</div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Mostrar inactivas
            </label>
            <button className="btn primary" onClick={startCreate}>Nueva categoría</button>
          </div>
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="tableWrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Orden</th>
                <th>Color</th>
                <th>Activo</th>
                <th style={{ width: 220 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="small">Cargando…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="small">Sin categorías</td></tr>
              ) : items.map(c => (
                <tr key={c.categoryId}>
                  <td style={{ fontWeight: 600 }}>{c.nombre}</td>
                  <td>{c.orden}</td>
                  <td>{c.color || '-'}</td>
                  <td>{c.activo ? <span className="badge on">Activa</span> : <span className="badge off">Inactiva</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn" onClick={() => startEdit(c)}>Editar</button>
                      <button className="btn danger" onClick={() => remove(c)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar categoría' : 'Nueva categoría'}>
        <div className="form">
          <div className="field">
            <label>Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: JABON_ROPA" />
          </div>
          <div className="field">
            <label>Orden</label>
            <input type="number" value={orden} onChange={(e) => setOrden(parseInt(e.target.value || '0', 10))} />
          </div>
          <div className="field">
            <label>Color (opcional)</label>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#00A3FF o nombre" />
          </div>
          <label className="row small" style={{ gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activa
          </label>

          <div className="row space" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn primary" onClick={save}>Guardar</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
