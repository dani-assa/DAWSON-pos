import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { sendError } from "../errors.js";

export const productsAdminRouter = express.Router();
productsAdminRouter.use(requireAuth);

// ADMIN: crear/listar producto base, crear/listar presentaciones, ajustar stock
productsAdminRouter.get("/product-bases", requireRole("ADMIN"), async (req, res) => {
  const includeArchived = (req.query.includeArchived || "false").toString() === "true";
  try {
    const { rows } = await pool.query(`SELECT id as "productBaseId", nombre, categoria, unidad_stock as "unidadStock",
              stock_actual as "stockActual", stock_minimo as "stockMinimo", activo
       FROM product_bases
       WHERE ($1::boolean = true) OR archivado = false
       ORDER BY nombre ASC`,
      [includeArchived]
    );
    return res.json({ items: rows });
  } catch (e) {
    return sendError(res, e);
  }
});

productsAdminRouter.post("/product-bases", requireRole("ADMIN"), async (req, res) => {
  try {
    const { nombre, categoria, unidadStock, stockMinimo, activo } = req.body || {};
    if (!nombre || !categoria || !unidadStock) {
      return res.status(400).json({ error: "bad_request", message: "Faltan campos obligatorios" });
    }

    const { rows } = await pool.query(
      `INSERT INTO product_bases(nombre, categoria, unidad_stock, stock_minimo, activo)
       VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,true))
       RETURNING id as "productBaseId", nombre, categoria, unidad_stock as "unidadStock",
                 stock_actual as "stockActual", stock_minimo as "stockMinimo", activo`,
      [nombre, categoria, unidadStock, stockMinimo ?? null, activo ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

productsAdminRouter.get("/products", requireRole("ADMIN"), async (req, res) => {
  const includeArchivedProd = (req.query.includeArchived || "false").toString() === "true";
  try {
    const search = (req.query.search || "").toString().trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || "25", 10)));
    const offset = (page - 1) * pageSize;

    const params = [];
    let where = "WHERE 1=1";
    if (!includeArchivedProd) where += " AND p.archivado = false";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND p.nombre ILIKE $${params.length}`;
    }

    const countQ = `SELECT COUNT(*)::int AS total FROM products p ${where}`;
    const listQ = `
      SELECT p.id as "productId",
             p.product_base_id as "productBaseId",
             p.nombre,
             p.categoria,
             p.tipo,
             p.cantidad_descuento as "cantidadDescuento",
             p.precio_venta_centavos as "precioVenta",
             p.activo
      FROM products p
      ${where}
      ORDER BY p.nombre ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const [{ rows: c }, { rows }] = await Promise.all([pool.query(countQ, params), pool.query(listQ, params)]);
    return res.json({ items: rows, page, pageSize, total: c[0]?.total || 0 });
  } catch (e) {
    return sendError(res, e);
  }
});

productsAdminRouter.post("/products", requireRole("ADMIN"), async (req, res) => {
  try {
    const { productBaseId, nombre, categoria, tipo, cantidadDescuento, precioVenta, activo } = req.body || {};
    if (!productBaseId || !nombre || !categoria || !tipo || cantidadDescuento === undefined || precioVenta === undefined || activo === undefined) {
      return res.status(400).json({ error: "bad_request", message: "Faltan campos obligatorios" });
    }

    const { rows: pb } = await pool.query(`SELECT id FROM product_bases WHERE id=$1`, [productBaseId]);
    if (!pb[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const { rows } = await pool.query(
      `INSERT INTO products(product_base_id, nombre, categoria, tipo, cantidad_descuento, precio_venta_centavos, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id as "productId", product_base_id as "productBaseId", nombre, categoria, tipo,
                 cantidad_descuento as "cantidadDescuento", precio_venta_centavos as "precioVenta", activo`,
      [productBaseId, nombre, categoria, tipo, cantidadDescuento, precioVenta, activo]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

productsAdminRouter.post("/product-bases/:productBaseId/stock-adjust", requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { productBaseId } = req.params;
    const { cantidad, motivo } = req.body || {};
    const qty = Number(cantidad);

    if (!motivo || !Number.isFinite(qty) || qty === 0) {
      return res.status(400).json({ error: "bad_request", message: "Faltan campos obligatorios" });
    }

    const { rows: exists } = await pool.query(`SELECT id FROM product_bases WHERE id=$1`, [productBaseId]);
    if (!exists[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    await client.query("BEGIN");

    await client.query(`UPDATE product_bases SET stock_actual = stock_actual + $2 WHERE id=$1`, [productBaseId, qty]);

    await client.query(
      `INSERT INTO stock_movements(product_base_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
       VALUES ($1,'AJUSTE',$2,'STOCK_ADJUST',$3,$4)`,
      [productBaseId, qty, productBaseId, req.user.id]
    );

    await client.query(
      `INSERT INTO audit_log(usuario_id, accion, entidad, entidad_id, metadata)
       VALUES ($1,'STOCK_ADJUST','product_base',$2,$3)`,
      [req.user.id, productBaseId, JSON.stringify({ cantidad: qty, motivo })]
    );

    const { rows: pbOut } = await client.query(
      `SELECT id as "productBaseId", nombre, categoria, unidad_stock as "unidadStock",
              stock_actual as "stockActual", stock_minimo as "stockMinimo", activo
       FROM product_bases WHERE id=$1`,
      [productBaseId]
    );

    await client.query("COMMIT");
    return res.json(pbOut[0]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return sendError(res, e);
  } finally {
    client.release();
  }
});


// PATCH /products/:productId (ADMIN)
productsAdminRouter.patch("/products/:productId", requireRole("ADMIN"), async (req, res) => {
  try {
    const { productId } = req.params;
    const { nombre, precioVenta, activo } = req.body || {};

    const { rows } = await pool.query(
      `UPDATE products
       SET nombre=COALESCE($2,nombre),
           precio_venta_centavos=COALESCE($3,precio_venta_centavos),
           activo=COALESCE($4,activo)
       WHERE id=$1
       RETURNING id as "productId", product_base_id as "productBaseId", nombre, categoria, tipo, cantidad_descuento as "cantidadDescuento",
                 precio_venta_centavos as "precioVenta", activo`,
      [productId, nombre ?? null, precioVenta ?? null, activo ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    return res.json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

// PATCH /product-bases/:productBaseId (ADMIN)
productsAdminRouter.patch("/product-bases/:productBaseId", requireRole("ADMIN"), async (req, res) => {
  try {
    const { productBaseId } = req.params;
    const { nombre, categoria, stockMinimo, activo } = req.body || {};

    const { rows } = await pool.query(
      `UPDATE product_bases
       SET nombre=COALESCE($2,nombre),
           categoria=COALESCE($3,categoria),
           stock_minimo=COALESCE($4,stock_minimo),
           activo=COALESCE($5,activo)
       WHERE id=$1
       RETURNING id as "productBaseId", nombre, categoria, unidad_stock as "unidadStock",
                 stock_actual as "stockActual", stock_minimo as "stockMinimo", activo`,
      [productBaseId, nombre ?? null, categoria ?? null, stockMinimo ?? null, activo ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    return res.json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});


// (ADMIN) Eliminar/Archivar presentación
productsAdminRouter.delete("/products/:productId", requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { productId } = req.params;
    const { rows: p } = await client.query(`SELECT id FROM products WHERE id=$1`, [productId]);
    if (!p[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const [{ rows: si }, { rows: cc }] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM sale_items WHERE product_id=$1`, [productId]),
      client.query(`SELECT COUNT(*)::int AS n FROM combo_components WHERE product_id=$1`, [productId]),
    ]);
    const referenced = (si[0].n || 0) > 0 || (cc[0].n || 0) > 0;

    if (referenced) {
      const { rows } = await client.query(
        `UPDATE products SET activo=false, archivado=true WHERE id=$1
         RETURNING id as "productId", product_base_id as "productBaseId", nombre, categoria, tipo,
                   cantidad_descuento as "cantidadDescuento", precio_venta_centavos as "precioVenta", activo, archivado`,
        [productId]
      );
      return res.json({ deletedMode: "SOFT", item: rows[0] });
    }

    await client.query(`DELETE FROM products WHERE id=$1`, [productId]);
    return res.json({ deletedMode: "HARD" });
  } catch (e) {
    return sendError(res, e);
  } finally {
    client.release();
  }
});

// (ADMIN) Eliminar/Archivar producto base
productsAdminRouter.delete("/product-bases/:productBaseId", requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { productBaseId } = req.params;
    const { rows: pb } = await client.query(`SELECT id FROM product_bases WHERE id=$1`, [productBaseId]);
    if (!pb[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const [{ rows: pcount }, { rows: sm }] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM products WHERE product_base_id=$1`, [productBaseId]),
      client.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_base_id=$1`, [productBaseId]),
    ]);
    const referenced = (pcount[0].n || 0) > 0 || (sm[0].n || 0) > 0;

    if (referenced) {
      const { rows } = await client.query(
        `UPDATE product_bases SET activo=false, archivado=true WHERE id=$1
         RETURNING id as "productBaseId", nombre, categoria, unidad_stock as "unidadStock",
                   stock_actual as "stockActual", stock_minimo as "stockMinimo", activo, archivado`,
        [productBaseId]
      );
      return res.json({ deletedMode: "SOFT", item: rows[0] });
    }

    await client.query(`DELETE FROM product_bases WHERE id=$1`, [productBaseId]);
    return res.json({ deletedMode: "HARD" });
  } catch (e) {
    return sendError(res, e);
  } finally {
    client.release();
  }
});
