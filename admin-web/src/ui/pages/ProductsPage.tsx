import React, { useEffect, useState } from 'react'
import { api, Product, ProductBase, ProductoTipo } from '../services/api'
import { Modal } from '../widgets/Modal'

const TIPOS: ProductoTipo[] = ['GRANEL', 'MARCA', 'COMBO']

function formatPesos(value: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function parsePesosInput(s: string): number | null {
  const raw = String(s ?? '').trim()
  if (!raw) return null
  // permite "2.100" y "2100"
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  // sin centavos: entero
  return Math.round(n)
}

export function ProductsPage() {
  const [items, setItems] = useState<Product[]>([])
  const [bases, setBases] = useState<ProductBase[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<Product | null>(null)

  const refresh = async () => {
    setError('')
    setLoading(true)
    try {
      const [pb, pr] = await Promise.all([
        api.listProductBases(),
        api.listProducts(search, page, pageSize, includeArchived),
      ])
      setBases(pb.items)
      setItems(pr.items)
      setTotal(pr.total)
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, includeArchived])

  const doSearch = () => {
    setPage(1)
    refresh()
  }

  const toggleActive = async (p: Product) => {
    const next = !p.activo
    setItems(prev => prev.map(x => (x.productId === p.productId ? { ...x, activo: next } : x)))
    try {
      await api.updateProduct(p.productId, { activo: next })
    } catch (e: any) {
      setError(e?.message || 'Error')
      setItems(prev => prev.map(x => (x.productId === p.productId ? { ...x, activo: p.activo } : x)))
    }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 14 }}>
        <div className="row space">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => setShowCreate(true)}>
              Nueva presentación
            </button>

            <input
              className="input"
              style={{ width: 280 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre (exacto/parcial)"
            />
            <button className="btn" onClick={doSearch}>Buscar</button>

            <label className="row" style={{ gap: 8, marginLeft: 10 }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1) }}
              />
              <span className="small">Incluir archivados</span>
            </label>
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
              <th>Tipo</th>
              <th>Desc.</th>
              <th>Precio</th>
              <th>Activo</th>
              <th style={{ width: 200 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>Cargando…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 14, color: 'var(--muted)' }}>Sin datos</td></tr>
            )}
            {items.map(p => (
              <tr key={p.productId}>
                <td>
                  <div style={{ fontWeight: 650 }}>{p.nombre}</div>
                  <div className="small">
                    Base: {bases.find(b => b.productBaseId === p.productBaseId)?.nombre || p.productBaseId}
                  </div>
                </td>
                <td>{p.tipo}</td>
                <td>{p.cantidadDescuento}</td>
                <td>${formatPesos(p.precioVenta)}</td>
                <td><span className={'badge ' + (p.activo ? 'on' : 'off')}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <button className="btn" onClick={() => setShowEdit(p)}>Editar</button>
                  <button className={p.activo ? 'btn danger' : 'btn primary'} onClick={() => toggleActive(p)}>
                    {p.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row space">
        <div className="small">Total: {total}</div>
        <div className="row">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</button>
          <span className="badge">Página {page}</span>
          <button className="btn" disabled={(page * pageSize) >= total} onClick={() => setPage(p => p + 1)}>Siguiente</button>
          <select className="select" style={{ width: 110 }} value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}>
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}/pág</option>)}
          </select>
        </div>
      </div>

      {showEdit && (
        <EditProductModal
          p={showEdit}
          bases={bases}
          onClose={() => setShowEdit(null)}
          onSaved={() => { setShowEdit(null); refresh() }}
        />
      )}

      {showCreate && (
        <CreateProductModal
          bases={bases}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh() }}
        />
      )}
    </div>
  )
}

function CreateProductModal({ bases, onClose, onCreated }: { bases: ProductBase[], onClose: () => void, onCreated: () => void }) {
  const [productBaseId, setProductBaseId] = useState(bases[0]?.productBaseId || '')
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('JABON_ROPA')
  const [tipo, setTipo] = useState<ProductoTipo>('GRANEL')
  const [cantidadDescuento, setCantidadDescuento] = useState('1')
  const [precioVenta, setPrecioVenta] = useState('0') // PESOS sin centavos
  const [activo, setActivo] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setError('')
    if (!productBaseId) { setError('Elegí un producto base'); return }
    if (!nombre.trim()) { setError('Nombre obligatorio'); return }

    const qty = Number(cantidadDescuento)
    if (!Number.isFinite(qty) || qty <= 0) { setError('Cantidad descuento inválida'); return }

    const pesosInt = parsePesosInput(precioVenta)
    if (pesosInt === null || pesosInt < 0) { setError('Precio inválido'); return }

    setSaving(true)
    try {
      await api.createProduct({
        productBaseId,
        nombre: nombre.trim(),
        categoria: categoria.trim(),
        tipo,
        cantidadDescuento: qty,
        precioVenta: pesosInt, // PESOS
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
    <Modal title="Nueva presentación" onClose={onClose}>
      <div className="grid2">
        <div className="col">
          <label className="small">Producto base</label>
          <select className="select" value={productBaseId} onChange={(e) => setProductBaseId(e.target.value)}>
            {bases.map(b => <option key={b.productBaseId} value={b.productBaseId}>{b.nombre}</option>)}
          </select>
        </div>
        <div className="col">
          <label className="small">Tipo</label>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="col">
          <label className="small">Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Jabón tipo Skip - 5 Lts" />
        </div>
        <div className="col">
          <label className="small">Categoría</label>
          <input className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
        </div>

        <div className="col">
          <label className="small">Cantidad descuento</label>
          <input className="input" value={cantidadDescuento} onChange={(e) => setCantidadDescuento(e.target.value)} />
          <div className="small">Ej: 1 o 5 (descuenta del stock base)</div>
        </div>
        <div className="col">
          <label className="small">Precio venta ($)</label>
          <input className="input" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} placeholder="Ej: 2800" />
          <div className="small">Se ingresa en pesos, sin centavos.</div>
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

function EditProductModal({ p, bases, onClose, onSaved }: { p: Product, bases: ProductBase[], onClose: () => void, onSaved: () => void }) {
  const [nombre, setNombre] = useState(p.nombre)
  const [categoria, setCategoria] = useState(p.categoria)
  const [tipo, setTipo] = useState(p.tipo)
  const [cantidadDescuento, setCantidadDescuento] = useState(String(p.cantidadDescuento))
  const [precioVenta, setPrecioVenta] = useState(String(p.precioVenta)) // PESOS
  const [activo, setActivo] = useState(!!p.activo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true); setError('')
    try {
      const pesosInt = parsePesosInput(precioVenta)
      if (pesosInt === null || pesosInt < 0) {
        setError('Precio inválido')
        setSaving(false)
        return
      }

      await api.updateProduct(p.productId, {
        nombre: nombre.trim(),
        categoria,
        tipo,
        cantidadDescuento: Number(cantidadDescuento),
        precioVenta: pesosInt, // PESOS
        activo,
      } as any)
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  const baseName = bases.find(b => b.productBaseId === p.productBaseId)?.nombre || p.productBaseId

  return (
    <Modal title="Editar presentación" onClose={onClose}>
      <div className="col" style={{ gap: 10 }}>
        <div className="small">Base: {baseName}</div>

        <label className="label">Nombre</label>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />

        <div className="grid2">
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Categoría</label>
            <input className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            <div className="small">Debe coincidir con las categorías del sistema.</div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Tipo</label>
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
              <option value="GRANEL">GRANEL</option>
              <option value="MARCA">MARCA</option>
              <option value="COMBO">COMBO</option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Cantidad descuento</label>
            <input className="input" value={cantidadDescuento} onChange={(e) => setCantidadDescuento(e.target.value)} />
          </div>
          <div className="col" style={{ gap: 6 }}>
            <label className="label">Precio venta ($)</label>
            <input className="input" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} />
            <div className="small">Se ingresa en pesos, sin centavos.</div>
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
