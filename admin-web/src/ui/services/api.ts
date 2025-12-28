export type Role = 'ADMIN' | 'CAJERO'

export type AuthUser = {
  id: string
  usuario: string
  nombre?: string
  role?: Role
  rol?: Role
}

const TOKEN_KEY = 'dawson.token'
const USER_KEY = 'dawson.user'
const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000/api/v1'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function authHeader() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export const api = {
  baseUrl: API_URL,
  getSavedUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try { return JSON.parse(raw) as AuthUser } catch { return null }
  },
  async login(usuario: string, password: string): Promise<{ token: string, user: AuthUser }> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    })
    if (!res.ok) {
      const msg = await safeMsg(res)
      throw new Error(msg || 'Login inválido')
    }
    return await res.json()
  },
  async listProductBases(includeArchived: boolean = false): Promise<{ items: ProductBase[] }> {
    const res = await fetch(`${API_URL}/product-bases?includeArchived=${includeArchived}`, { headers: { ...authHeader() } })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al listar productos base')
    return await res.json()
  },
  async createProductBase(payload: CreateProductBaseRequest): Promise<ProductBase> {
    const res = await fetch(`${API_URL}/product-bases?includeArchived=${includeArchived}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al crear producto base')
    return await res.json()
  },
  async adjustStock(productBaseId: string, payload: StockAdjustRequest): Promise<ProductBase> {
    const res = await fetch(`${API_URL}/product-bases/${productBaseId}/stock-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al ajustar stock')
    return await res.json()
  },
  async listProducts(search: string, page: number, pageSize: number, includeArchived: boolean = false): Promise<ProductListResponse> {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (includeArchived) params.set('includeArchived', 'true')
    const res = await fetch(`${API_URL}/products?${params.toString()}`, { headers: { ...authHeader() } })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al listar presentaciones')
    return await res.json()
  },
  async createProduct(payload: CreateProductRequest): Promise<Product> {
    const res = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al crear presentación')
    return await res.json()
  },
  async toggleProductActive(productId: string, activo: boolean): Promise<Product> {
    const res = await fetch(`${API_URL}/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ activo }),
    })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al cambiar activo')
    return await res.json()
  },
  async updateProductBase(productBaseId: string, payload: Partial<Pick<ProductBase,'nombre'|'unidadStock'|'stockMinimo'|'activo'>>): Promise<ProductBase> {
    const res = await fetch(`${API_URL}/product-bases/${productBaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  async updateProduct(productId: string, payload: Partial<Pick<Product,'nombre'|'categoria'|'tipo'|'cantidadDescuento'|'precioVenta'|'activo'>>): Promise<Product> {
    const res = await fetch(`${API_URL}/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

async toggleProductBaseActive(productBaseId: string, activo: boolean): Promise<ProductBase> {
    const res = await fetch(`${API_URL}/product-bases/${productBaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ activo }),
    })
    if (!res.ok) throw new Error(await safeMsg(res) || 'Error al cambiar activo')
    return await res.json()
  },
}

async function safeMsg(res: Response): Promise<string> {
  try {
    const data = await res.json()
    return data?.message || data?.error || ''
  } catch {
    try { return await res.text() } catch { return '' }
  }
}

export type UnidadStock = 'LITROS' | 'KILOS' | 'UNIDADES'
export type Categoria = string
export type ProductoTipo = 'GRANEL' | 'MARCA' | 'COMBO'

export type ProductBase = {
  productBaseId: string
  nombre: string
  categoria: Categoria
  unidadStock: UnidadStock
  stockActual: number
  stockMinimo: number
  activo: boolean
}

export type CreateProductBaseRequest = {
  nombre: string
  categoria: Categoria
  unidadStock: UnidadStock
  stockMinimo?: number
  activo?: boolean
}

export type StockAdjustRequest = {
  cantidad: number
  motivo: string
}

export type Product = {
  productId: string
  productBaseId: string
  nombre: string
  categoria: Categoria
  tipo: ProductoTipo
  cantidadDescuento: number
  precioVenta: number // centavos
  activo: boolean
}
export type CreateProductRequest = {
  productBaseId: string
  nombre: string
  categoria: Categoria
  tipo: ProductoTipo
  cantidadDescuento: number
  precioVenta: number
  activo: boolean
}

export type ProductListResponse = {
  items: Product[]
  page: number
  pageSize: number
  total: number
}
