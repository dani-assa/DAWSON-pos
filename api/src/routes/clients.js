import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendError, httpError } from "../errors.js";

export const clientsRouter = express.Router();
clientsRouter.use(requireAuth);

clientsRouter.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").toString().trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || "25", 10)));
    const offset = (page - 1) * pageSize;

    const params = [];
    let where = "WHERE activo=true";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND nombre ILIKE $${params.length}`;
    }

    const countQ = `SELECT COUNT(*)::int AS total FROM clientes ${where}`;
    const listQ = `SELECT id, nombre, telefono, direccion FROM clientes ${where} ORDER BY nombre ASC LIMIT ${pageSize} OFFSET ${offset}`;

    const [{ rows: countRows }, { rows }] = await Promise.all([
      pool.query(countQ, params),
      pool.query(listQ, params),
    ]);

    return res.json({ items: rows, page, pageSize, total: countRows[0]?.total || 0 });
  } catch (e) {
    return sendError(res, e);
  }
});

clientsRouter.post("/", async (req, res) => {
  try {
    const { nombre, telefono, direccion } = req.body || {};
    if (!nombre || !telefono || !direccion) throw httpError(400, "bad_request", "Faltan campos obligatorios");

    try {
      const { rows } = await pool.query(
        `INSERT INTO clientes(nombre, telefono, direccion) VALUES ($1,$2,$3)
         RETURNING id, nombre, telefono, direccion`,
        [nombre, telefono, direccion]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (String(err?.code) === "23505") {
        const { rows } = await pool.query(`SELECT id FROM clientes WHERE telefono=$1`, [telefono]);
        return res.status(409).json({
          error: "phone_already_exists",
          message: "Ya existe un cliente con ese teléfono.",
          existingClientId: rows[0]?.id,
        });
      }
      throw err;
    }
  } catch (e) {
    return sendError(res, e);
  }
});

clientsRouter.get("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { rows } = await pool.query(`SELECT id, nombre, telefono, direccion FROM clientes WHERE id=$1`, [clientId]);
    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    return res.json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

clientsRouter.patch("/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { nombre, telefono, direccion } = req.body || {};

    const { rows: existing } = await pool.query(`SELECT id FROM clientes WHERE id=$1`, [clientId]);
    if (!existing[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    try {
      const { rows } = await pool.query(
        `UPDATE clientes
         SET nombre=COALESCE($2,nombre),
             telefono=COALESCE($3,telefono),
             direccion=COALESCE($4,direccion)
         WHERE id=$1
         RETURNING id, nombre, telefono, direccion`,
        [clientId, nombre ?? null, telefono ?? null, direccion ?? null]
      );
      return res.json(rows[0]);
    } catch (err) {
      if (String(err?.code) === "23505") {
        const { rows } = await pool.query(`SELECT id FROM clientes WHERE telefono=$1`, [telefono]);
        return res.status(409).json({
          error: "phone_already_exists",
          message: "Ya existe un cliente con ese teléfono.",
          existingClientId: rows[0]?.id,
        });
      }
      throw err;
    }
  } catch (e) {
    return sendError(res, e);
  }
});
