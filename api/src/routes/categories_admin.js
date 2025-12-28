import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { sendError } from "../errors.js";

export const categoriesAdminRouter = express.Router();
categoriesAdminRouter.use(requireAuth);

categoriesAdminRouter.get("/categories", requireRole("ADMIN"), async (req, res) => {
  try {
    const includeInactive = (req.query.includeInactive || "false").toString() === "true";
    const where = includeInactive ? "" : "WHERE activo = true";
    const { rows } = await pool.query(
      `SELECT id as "categoryId", nombre, color, orden, activo
       FROM categories
       ${where}
       ORDER BY orden ASC, nombre ASC`
    );
    return res.json({ items: rows });
  } catch (e) {
    return sendError(res, e);
  }
});

categoriesAdminRouter.post("/categories", requireRole("ADMIN"), async (req, res) => {
  try {
    const { nombre, color, orden, activo } = req.body || {};
    if (!nombre || typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({ error: "bad_request", message: "Faltan campos obligatorios" });
    }
    const { rows } = await pool.query(
      `INSERT INTO categories(nombre, color, orden, activo)
       VALUES ($1, $2, COALESCE($3,0), COALESCE($4,true))
       RETURNING id as "categoryId", nombre, color, orden, activo`,
      [nombre.trim(), color ?? null, orden ?? null, activo ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

categoriesAdminRouter.patch("/categories/:categoryId", requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { categoryId } = req.params;
    const { nombre, color, orden, activo } = req.body || {};

    const { rows: current } = await client.query(
      `SELECT id, nombre, color, orden, activo FROM categories WHERE id=$1`,
      [categoryId]
    );
    if (!current[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const oldName = current[0].nombre;

    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE categories
       SET nombre = COALESCE($2, nombre),
           color = COALESCE($3, color),
           orden = COALESCE($4, orden),
           activo = COALESCE($5, activo),
           updated_at = now()
       WHERE id = $1
       RETURNING id as "categoryId", nombre, color, orden, activo`,
      [categoryId, nombre ?? null, color ?? null, orden ?? null, activo ?? null]
    );

    const newName = rows[0].nombre;
    if (nombre && nombre.trim() && newName !== oldName) {
      await client.query(`UPDATE product_bases SET categoria=$2 WHERE categoria=$1`, [oldName, newName]);
      await client.query(`UPDATE products SET categoria=$2 WHERE categoria=$1`, [oldName, newName]);
    }

    await client.query("COMMIT");
    return res.json(rows[0]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return sendError(res, e);
  } finally {
    client.release();
  }
});

categoriesAdminRouter.delete("/categories/:categoryId", requireRole("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { categoryId } = req.params;
    const { rows: cat } = await client.query(`SELECT id, nombre FROM categories WHERE id=$1`, [categoryId]);
    if (!cat[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    const name = cat[0].nombre;

    const [{ rows: pbCount }, { rows: pCount }] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM product_bases WHERE categoria=$1`, [name]),
      client.query(`SELECT COUNT(*)::int AS n FROM products WHERE categoria=$1`, [name]),
    ]);
    const referenced = (pbCount[0].n || 0) > 0 || (pCount[0].n || 0) > 0;

    if (referenced) {
      const { rows } = await client.query(
        `UPDATE categories SET activo=false, updated_at=now()
         WHERE id=$1
         RETURNING id as "categoryId", nombre, color, orden, activo`,
        [categoryId]
      );
      return res.json({ ...rows[0], deletedMode: "SOFT" });
    }

    await client.query(`DELETE FROM categories WHERE id=$1`, [categoryId]);
    return res.json({ deletedMode: "HARD" });
  } catch (e) {
    return sendError(res, e);
  } finally {
    client.release();
  }
});
