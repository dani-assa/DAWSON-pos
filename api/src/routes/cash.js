import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendError, httpError } from "../errors.js";

export const cashRouter = express.Router();
cashRouter.use(requireAuth);

// POST /cash-sessions/open
cashRouter.post("/open", async (req, res) => {
  try {
    const { montoInicial } = req.body || {};
    if (montoInicial === undefined || montoInicial === null) throw httpError(400, "bad_request", "Faltan campos obligatorios");

    const { rows: openRows } = await pool.query(
      `SELECT id FROM cash_sessions WHERE usuario_id=$1 AND estado='ABIERTA'`,
      [req.user.id]
    );
    if (openRows[0]) {
      return res.status(422).json({ error: "cash_session_state_invalid", message: "Ya existe una caja abierta" });
    }

    const { rows } = await pool.query(
      `INSERT INTO cash_sessions(usuario_id, estado, monto_inicial_centavos)
       VALUES ($1,'ABIERTA',$2)
       RETURNING id as "cashSessionId", estado, fecha_apertura as "fechaApertura"`,
      [req.user.id, montoInicial]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

// POST /cash-sessions/:cashSessionId/close
cashRouter.post("/:cashSessionId/close", async (req, res) => {
  try {
    const { cashSessionId } = req.params;
    const { montoDeclarado, observaciones } = req.body || {};
    if (montoDeclarado === undefined || montoDeclarado === null) throw httpError(400, "bad_request", "Faltan campos obligatorios");

    const { rows } = await pool.query(
      `SELECT id, estado, usuario_id FROM cash_sessions WHERE id=$1`,
      [cashSessionId]
    );
    const cs = rows[0];
    if (!cs) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    if (cs.usuario_id !== req.user.id) {
      // por ahora: solo el dueño del turno cierra su caja
      return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    }
    if (cs.estado !== "ABIERTA") return res.status(422).json({ error: "cash_session_state_invalid", message: "La caja no está abierta" });

    const { rows: upd } = await pool.query(
      `UPDATE cash_sessions
       SET estado='CERRADA', fecha_cierre=now(), monto_declarado_centavos=$2, observaciones=$3
       WHERE id=$1
       RETURNING id as "cashSessionId", estado, fecha_cierre as "fechaCierre"`,
      [cashSessionId, montoDeclarado, observaciones ?? null]
    );
    return res.json(upd[0]);
  } catch (e) {
    return sendError(res, e);
  }
});
