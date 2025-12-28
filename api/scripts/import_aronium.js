#!/usr/bin/env node
/**
 * Aronium CSV Importer for Dawson POS
 *
 * Usage (inside api container):
 *   node scripts/import_aronium.js /import/customers.csv /import/products.csv /import/stock.csv
 *
 * Notes:
 * - Customers upserted by telefono (Phone).
 * - Products: creates/updates product_bases by nombre+categ; creates/updates ONE presentation (cantidad_descuento=1) per base.
 * - Stock: sets product_bases.stock_actual from Stock CSV matching by product name (exact trim match).
 * - Creates categories rows (if table exists) for each ProductGroup.
 */
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Pool } = pg;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function asStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeName(s) {
  return asStr(s).replace(/\s+/g, " ").trim();
}

function parseMoneyToCents(v) {
  // Accept "1234.56" or "1.234,56" or "1234,56"
  const s = asStr(v);
  if (!s) return 0;
  let t = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function mapUnidadStock(measurementUnit) {
  const u = asStr(measurementUnit).toLowerCase();
  if (u.includes("lit")) return "LITROS";
  if (u.includes("kilo") || u.includes("kg")) return "KILOS";
  return "UNIDADES";
}

function mapTipo(unidadStock) {
  return (unidadStock === "UNIDADES") ? "UNITARIO" : "GRANEL";
}

function readCsv(filePath, delimiterGuess) {
  if (!fs.existsSync(filePath)) die(`No existe: ${filePath}`);
  const content = fs.readFileSync(filePath);
  // Try delimiter(s)
  const candidates = delimiterGuess ? [delimiterGuess] : [",", ";", "\t"];
  for (const delimiter of candidates) {
    try {
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        delimiter,
        relax_quotes: true,
        relax_column_count: true
      });
      if (records && records.length >= 0) return records;
    } catch (_) {}
  }
  die(`No pude leer CSV: ${filePath}`);
}

async function main() {
  const [customersPath, productsPath, stockPath] = process.argv.slice(2);
  if (!customersPath || !productsPath || !stockPath) {
    die("Uso: node scripts/import_aronium.js <customers.csv> <products.csv> <stock.csv>");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const customers = readCsv(customersPath, ",");
  const products = readCsv(productsPath, ",");
  const stock = readCsv(stockPath, ";"); // Aronium stock export uses ';' typically

  // Prepare stock map by product name (exact trimmed)
  const stockMap = new Map();
  for (const r of stock) {
    const prodName = normalizeName(r["Producto"] ?? r["Product"] ?? r["Name"] ?? "");
    if (!prodName) continue;
    let qty = asStr(r["Cant."] ?? r["Qty"] ?? r["Quantity"] ?? "");
    qty = qty.replace(",", ".");
    const n = Number(qty);
    if (!Number.isFinite(n)) continue;
    stockMap.set(prodName, n);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // categories table optional
    let hasCategories = false;
    let hasArchivadoPB = false;
    let hasArchivadoP = false;
    try {
      await client.query("SELECT 1 FROM categories LIMIT 1");
      hasCategories = true;
    } catch (_) {}

    try { await client.query("SELECT archivado FROM product_bases LIMIT 1"); hasArchivadoPB = true; } catch (_) {}
try { await client.query("SELECT archivado FROM products LIMIT 1"); hasArchivadoP = true; } catch (_) {}


    // 1) Customers upsert by telefono
    let insertedC = 0, updatedC = 0, skippedC = 0;
    for (const r of customers) {
      const nombre = normalizeName(r["Name"] ?? r["Nombre"] ?? "");
      const direccion = normalizeName(r["StreetName"] ?? r["Dirección"] ?? r["Direccion"] ?? "");
      const telefono = normalizeName(r["Phone"] ?? r["Teléfono"] ?? r["Telefono"] ?? "");
      if (!telefono || !nombre) { skippedC++; continue; }
      const { rowCount } = await client.query(
        `INSERT INTO clientes (nombre, direccion, telefono, activo)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (telefono)
         DO UPDATE SET nombre=EXCLUDED.nombre, direccion=EXCLUDED.direccion, activo=true
        `,
        [nombre, direccion || "-", telefono]
      );
      // rowCount is 1 for insert or update in pg, cannot distinguish reliably; track as inserted-ish
      insertedC += 1;
    }

    // 2) Products -> product_bases + one presentation
    let insertedPB = 0, insertedP = 0;
    for (const r of products) {
      const nombre = normalizeName(r["Name"] ?? r["Nombre"] ?? "");
      if (!nombre) continue;

      const categoriaRaw = normalizeName(r["ProductGroup"] ?? r["Categoria"] ?? r["Categoría"] ?? "");
      const categoria = categoriaRaw && categoriaRaw !== "(none)" ? categoriaRaw : "GENERAL";

      if (hasCategories) {
        await client.query(
          `INSERT INTO categories (nombre, orden, activo)
           VALUES ($1, 0, true)
           ON CONFLICT (nombre) DO NOTHING`,
          [categoria]
        );
      }

      const unidadStock = mapUnidadStock(r["MeasurementUnit"] ?? r["UM"] ?? r["Unidad"] ?? "");
      const tipo = mapTipo(unidadStock);

      // stock from stockMap if present
      const stockActual = stockMap.has(nombre) ? stockMap.get(nombre) : null;

      // upsert product base by (nombre, categoria)
      const { rows: pbRows } = await client.query(
        `INSERT INTO product_bases (nombre, categoria, unidad_stock, stock_actual, stock_minimo, activo${hasArchivadoPB ? ", archivado" : ""})
         VALUES ($1,$2,$3,COALESCE($4,0),0,true${hasArchivadoPB ? ", false" : ""})
         ON CONFLICT (nombre, categoria)
         DO UPDATE SET unidad_stock=EXCLUDED.unidad_stock,
                       stock_actual=CASE WHEN $4 IS NULL THEN product_bases.stock_actual ELSE EXCLUDED.stock_actual END,
                       activo=true
         RETURNING id`,
        [nombre, categoria, unidadStock, stockActual]
      );
      const productBaseId = pbRows[0].id;

      // one default presentation: name = same, cantidad_descuento=1
      const precioCents = parseMoneyToCents(r["Price"] ?? r["Precio"] ?? "");
      await client.query(
        `INSERT INTO products (product_base_id, nombre, categoria, tipo, cantidad_descuento, precio_venta_centavos, activo${hasArchivadoPB ? ", archivado" : ""})
         VALUES ($1,$2,$3,$4,1,$5,true${hasArchivadoPB ? ", false" : ""})
         ON CONFLICT (product_base_id, nombre)
         DO UPDATE SET categoria=EXCLUDED.categoria,
                       tipo=EXCLUDED.tipo,
                       precio_venta_centavos=EXCLUDED.precio_venta_centavos,
                       activo=true
        `,
        [productBaseId, nombre, categoria, tipo, precioCents]
      );
      insertedP += 1;
    }

    await client.query("COMMIT");

    console.log("Import OK");
    console.log(`Clientes procesados: ${customers.length} (telefono+nombre requeridos)`);
    console.log(`Productos procesados: ${products.length} (crea producto base + 1 presentación por item)`);
    console.log(`Stock items leídos: ${stockMap.size} (match por nombre exacto)`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("ERROR import:", e?.message || e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => die(e?.message || String(e)));
