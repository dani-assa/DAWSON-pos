# Dawson POS (API + DB) - Proyecto de prueba

Este proyecto levanta:
- PostgreSQL (db)
- API Node.js (api) con Swagger UI y endpoints POS

## Requisitos
- Docker y Docker Compose

## Arranque
Desde la carpeta del proyecto:
1) `docker compose up --build`
2) Abrir Swagger UI: `http://localhost:3000/docs`

## Usuarios de prueba (seed)
- ADMIN: usuario `admin` / password `admin123`
- CAJERO: usuario `cajero` / password `cajero123`

## Notas
- Dinero en centavos (integer)
- Stock con decimales (NUMERIC)
- Productos visibles en POS solo por activo/inactivo manual
- Stock se valida y descuenta al cobrar
- Combos: coincidencia exacta


## Admin endpoints (catálogo)
En Swagger UI verás nuevos endpoints:
- POST/GET `/api/v1/product-bases`
- POST/GET `/api/v1/products`
- POST `/api/v1/product-bases/{productBaseId}/stock-adjust`

> Nota: todos requieren rol ADMIN.


## Admin Web UI (diseño oscuro)
Se agregó un frontend mínimo para ADMIN.

- URL: http://localhost:5173
- Login: admin / admin123
- Requiere el backend corriendo (docker compose up --build)

Si ya tenías contenedores levantados, reiniciá:
- Ctrl+C
- docker compose down
- docker compose up --build


## v1.2.2
- Fix: Admin UI acepta `user.rol` desde el login.


## v1.4.0
- Admin: Categorías (CRUD)
- Admin: Eliminar/Archivar productos base y presentaciones (soft/hard)

### Nota sobre DB existente
Si ya tenías el volumen `dawson_db` creado, estas tablas/columnas nuevas no se crean automáticamente.
Opción rápida: `docker compose down -v` (borra datos) y levantar de nuevo.
Opción segura: ejecutar en psql los ALTER/CREATE del archivo `db/init/001_init.sql` (sección Categories/archivado).


## Import Aronium (CSV)
1. Copiar los CSV exportados desde Aronium en la carpeta `import/` del proyecto con estos nombres:
   - `import/customers.csv`
   - `import/products.csv`
   - `import/stock.csv`  (puede ser el archivo "Stock-YYYY-MM-DD.csv", renombrarlo a `stock.csv`)

2. Levantar el stack:
   ```bash
   docker compose up --build
   ```

3. Ejecutar el importador dentro del contenedor `api`:
   ```bash
   docker compose exec api node scripts/import_aronium.js /import/customers.csv /import/products.csv /import/stock.csv
   ```

Notas:
- Aronium no separa presentaciones: el import crea **1 presentación** por producto con `cantidad_descuento=1`.
  Luego podés crear presentaciones adicionales (ej. 5L) desde Admin.
- El stock se matchea por **nombre exacto** del producto (trim). Si un producto no coincide, queda stock 0.
