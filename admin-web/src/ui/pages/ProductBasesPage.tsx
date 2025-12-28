import React, { useEffect, useMemo, useState } from 'react'
import { api, ProductBase, UnidadStock } from '../services/api'
import { Modal } from '../widgets/Modal'

const UNIDADES: UnidadStock[] = ['LITROS','KILOS','UNIDADES']

export function ProductBasesPage() {
  const [items, setItems] = useState<ProductBase[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showAdjust, setShowAdjust] = useState<ProductBase | null>(null)
  const [showEdit, setShowEdit] = useState<ProductBase | null>(null)

  const refresh = async () => {
    setError('')
    setLoading(true)
    try {
      const data = await api.listProductBases()
      setItems(data.items)
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [includeArchived])

  const toggleActive = async (pb: ProductBase) => {
    const next = !pb.activo
    setItems(prev => prev.map(x => x.productBaseId === pb.productBaseId ? { ...x, activo: next } : x))
    try {
      await api.updateProductBase(pb.productBaseId, { activo: next })
    } catch (e: any) {
      setError(e?.message || 'Error')
      setItems(prev => prev.map(x => x.productBaseId === pb.productBaseId ? { ...x, activo: pb.activo } : x))
    }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 14 }}>
        <div className="row space">
          <div className="row" style={{ gap: 10 }}>
            <button className="btn primary" onClick={() => setShowCreate(true)}>Nuevo producto base</button>
          </div>
          <button className="btn" onClick={refresh}>Actualizar</button>
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Unidad</th>
              <th>Stock actual</th>
              <th>Mínimo</th>
              <th>Activo</th>
              <th style={{ width: 320 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>Cargando…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>Sin datos</td></tr>
            )}
            {items.map(pb => (
              <tr key={pb.productBaseId}>
                <td>
                  <div style={{ fontWeight: 650 }}>{pb.nombre}</div>
                  <div className="small">Categoría: {pb.categoria}</div>
                </td>
                <td>{pb.unidadStock}</td>
                <td>{Number(pb.stockActual).toLocaleString('es-AR')}</td>
                <td>{Number(pb.stockMinimo).toLocaleString('es-AR')}</td>
                <td>
                  <span className={'badge ' + (pb.activo ? 'on' : 'off')}>{pb.activo ? 'Activo' : 'Inactivo'}</span>
                </td>
                <td>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => setShowAdjust(pb)}>Ajustar stock</button>
                    <button className="btn" onClick={() => setShowEdit(pb)}>Editar</button>
                    <button className={pb.activo ? 'btn danger' : 'btn primary'} onClick={() => toggleActive(pb)}>
                      {pb.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {showEdit && (
        <EditProductBaseModal
          pb={showEdit}
          onClose={() => setShowEdit(null)}
          onSaved={() => { setShowEdit(null); refresh() }}
        />
      )}

      {showCreate && (
        <CreateProductBaseModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh() }}
        />
      )}

      {!!showAdjust && (
        <StockAdjustModal
          productBase={showAdjust}
          onClose={() => setShowAdjust(null)}
          onSaved={() => { setShowAdjust(null); refresh() }}
        />
      )}
    </div>
  )
}

function CreateProductBaseModal({ onClose, onCreated }: { onClose: () => void, onCreated: () => void }) {
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('JABON_ROPA')
  const [unidadStock, setUnidadStock] = useState<UnidadStock>('LITROS')
  const [stockMinimo, setStockMinimo] = useState('0')
  const [activo, setActivo] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true); setError('')
    try {
      await api.createProductBase({
        nombre: nombre.trim(),
        categoria: categoria.trim(),
        unidadStock,
        stockMinimo: Number(stockMinimo),
        activo,
      })
      onCreated()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Nuevo producto base" onClose={onClose}>
      <div className="grid2">
        <div className="col">
          <label className="small">Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Jabón tipo Skip" />
        </div>
        <div className="col">
          <label className="small">Categoría</label>
          <input className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej: JABON_ROPA" />
          <div className="small">Por ahora es texto (después lo fijamos a un catálogo).</div>
        </div>
        <div className="col">
          <label className="small">Unidad de stock</label>
          <select className="select" value={unidadStock} onChange={(e) => setUnidadStock(e.target.value as any)}>
            {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="col">
          <label className="small">Stock mínimo</label>
          <input className="input" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span className="small">Activo</span>
        </label>
      </div>

      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}

      <div className="row space" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Crear'}</button>
      </div>
    </Modal>
  )
}

function StockAdjustModal({ productBase, onClose, onSaved }: { productBase: ProductBase, onClose: () => void, onSaved: () => void }) {
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const qty = Number(cantidad)
    if (!Number.isFinite(qty) || qty === 0) { setError('La cantidad debe ser un número distinto de 0'); return }
    if (!motivo.trim()) { setError('El motivo es obligatorio'); return }

    setSaving(true); setError('')
    try {
      await api.adjustStock(productBase.productBaseId, { cantidad: qty, motivo: motivo.trim() })
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Ajustar stock — ${productBase.nombre}`} onClose={onClose}>
      <div className="col">
        <div className="small">Stock actual: <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{productBase.stockActual}</span> ({productBase.unidadStock})</div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <div className="col">
            <label className="small">Cantidad (positiva suma / negativa resta)</label>
            <input className="input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10 o -2.5" />
          </div>
          <div className="col">
            <label className="small">Motivo</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Stock inicial / Merma" />
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row space" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Confirmar ajuste'}</button>
        </div>
      </div>
    </Modal>
  )
}


function EditProductBaseModal({ pb, onClose, onSaved }: { pb: ProductBase, onClose: () => void, onSaved: () => void }) {
  const [nombre, setNombre] = useState(pb.nombre)
  const [unidadStock, setUnidadStock] = useState<UnidadStock>(pb.unidadStock)
  const [stockMinimo, setStockMinimo] = useState(String(pb.stockMinimo ?? 0))
  const [activo, setActivo] = useState(!!pb.activo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true); setError('')
    try {
      await api.updateProductBase(pb.productBaseId, {
        nombre: nombre.trim(),
        unidadStock,
        stockMinimo: Number(stockMinimo),
        activo,
      })
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Editar producto base" onClose={onClose}>
      <div className="col" style={{ gap: 10 }}>
        <label className="label">Nombre</label>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />

        <div className="grid2">
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Unidad</label>
            <select className="input" value={unidadStock} onChange={(e) => setUnidadStock(e.target.value as UnidadStock)}>
              {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Stock mínimo</label>
            <input className="input" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} />
          </div>
        </div>

        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span>Activo</span>
        </label>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </Modal>
  )
}
