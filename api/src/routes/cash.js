import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendError, httpError } from "../errors.js";

export const cashRouter = express.Router();
cashRouter.use(requireAuth);

/**
 * Reglas:
 * - API recibe y devuelve PESOS ENTEROS.
 * - DB guarda en CENTAVOS (integer).
 * - CAJERO no ve montoEsperado ni diferencia.
 * - ADMIN sí ve todo y puede ver cierres/listados.
 */

function toCentavos(pesos) {
  const n = Number(pesos);
  if (!Number.isFinite(n)) throw httpError(400, "bad_request", "Monto inválido");
  return Math.round(n * 100);
}

function toPesos(centavos) {
  const n = Number(centavos ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / 100);
}

function isAdmin(req) {
  return req.user?.rol === "ADMIN";
}

function sanitizeCashSessionRow(row, rol) {
  const base = {
    cashSessionId: row.id,
    estado: row.estado,
    fechaApertura: row.fecha_apertura,
    fechaCierre: row.fecha_cierre ?? null,
    usuarioId: row.usuario_id,
    montoInicial: toPesos(row.monto_inicial_centavos),
    montoDeclarado: row.monto_declarado_centavos == null ? null : toPesos(row.monto_declarado_centavos),
    observaciones: row.observaciones ?? null,
  };

  if (rol === "ADMIN") {
    base.montoEsperado = toPesos(row.monto_esperado_centavos ?? 0);
    base.diferencia = toPesos(row.diferencia_centavos ?? 0);
  }

  return base;
}

/**
 * MVP: por ahora "monto esperado" = monto inicial.
 * Luego, cuando integremos ventas+pago mixto:
 * - esperado efectivo = inicial + sum(pagos efectivo de ventas confirmadas del turno) - egresos, etc.
 */
async function computeExpectedCashCentavos(cashSessionId) {
  const { rows } = await pool.query(
    `SELECT monto_inicial_centavos
       FROM cash_sessions
      WHERE id=$1`,
    [cashSessionId]
  );
  if (!rows[0]) throw httpError(404, "not_found", "Recurso no encontrado");
  return Number(rows[0].monto_inicial_centavos ?? 0);
}

// ===============================
// POST /cash-sessions/open
// ===============================
cashRouter.post("/open", async (req, res) => {
  try {
    const { montoInicial } = req.body || {};
    if (montoInicial === undefined || montoInicial === null) {
      throw httpError(400, "bad_request", "Faltan campos obligatorios");
    }

    const montoInicialCentavos = toCentavos(montoInicial);

    // Solo 1 caja ABIERTA por usuario (mantengo comportamiento original)
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
       RETURNING id, estado, fecha_apertura, fecha_cierre, usuario_id,
                 monto_inicial_centavos, monto_declarado_centavos, observaciones,
                 monto_esperado_centavos, diferencia_centavos`,
      [req.user.id, montoInicialCentavos]
    );

    return res.status(201).json(sanitizeCashSessionRow(rows[0], req.user.rol));
  } catch (e) {
    return sendError(res, e);
  }
});

// ===============================
// GET /cash-sessions/current
// (útil para POS; CAJERO ve mínimo)
// ===============================
cashRouter.get("/current", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, estado, fecha_apertura, fecha_cierre, usuario_id,
              monto_inicial_centavos, monto_declarado_centavos, observaciones,
              monto_esperado_centavos, diferencia_centavos
         FROM cash_sessions
        WHERE usuario_id=$1 AND estado='ABIERTA'
        ORDER BY fecha_apertura DESC
        LIMIT 1`,
      [req.user.id]
    );

    if (!rows[0]) return res.json(null);

    return res.json(sanitizeCashSessionRow(rows[0], req.user.rol));
  } catch (e) {
    return sendError(res, e);
  }
});

// ===============================
// ADMIN ONLY: ver todos los turnos
// GET /cash-sessions
// ===============================
cashRouter.get("/", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    }

    const { rows } = await pool.query(
      `SELECT id, estado, fecha_apertura, fecha_cierre, usuario_id,
              monto_inicial_centavos, monto_declarado_centavos, observaciones,
              monto_esperado_centavos, diferencia_centavos
         FROM cash_sessions
        ORDER BY fecha_apertura DESC
        LIMIT 200`
    );

    return res.json(rows.map((r) => sanitizeCashSessionRow(r, "ADMIN")));
  } catch (e) {
    return sendError(res, e);
  }
});

// ===============================
// ADMIN ONLY: cierre del día (sumatoria)
// GET /cash-sessions/daily/summary?date=YYYY-MM-DD
// IMPORTANTE: esta ruta debe ir ANTES de "/:cashSessionId"
// ===============================
cashRouter.get("/daily/summary", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    }

    const date = req.query.date;
    if (!date) throw httpError(400, "bad_request", "date es obligatorio (YYYY-MM-DD)");

    const { rows } = await pool.query(
      `
      SELECT
        $1::date AS fecha,
        COUNT(*) AS turnos,
        COALESCE(SUM(monto_inicial_centavos),0) AS inicial_centavos,
        COALESCE(SUM(monto_declarado_centavos),0) AS declarado_centavos,
        COALESCE(SUM(monto_esperado_centavos),0) AS esperado_centavos,
        COALESCE(SUM(diferencia_centavos),0) AS diferencia_centavos
      FROM cash_sessions
      WHERE fecha_apertura >= ($1::date)::timestamptz
        AND fecha_apertura < (($1::date + 1)::date)::timestamptz
        AND estado='CERRADA'
      `,
      [date]
    );

    const r = rows[0];
    return res.json({
      fecha: r.fecha,
      turnos: Number(r.turnos),
      montoInicial: toPesos(r.inicial_centavos),
      montoDeclarado: toPesos(r.declarado_centavos),
      montoEsperado: toPesos(r.esperado_centavos),
      diferencia: toPesos(r.diferencia_centavos),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

// ===============================
// ADMIN ONLY: detalle de un turno
// GET /cash-sessions/:cashSessionId
// ===============================
cashRouter.get("/:cashSessionId", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    }

    const { cashSessionId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, estado, fecha_apertura, fecha_cierre, usuario_id,
              monto_inicial_centavos, monto_declarado_centavos, observaciones,
              monto_esperado_centavos, diferencia_centavos
         FROM cash_sessions
        WHERE id=$1`,
      [cashSessionId]
    );

    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    return res.json(sanitizeCashSessionRow(rows[0], "ADMIN"));
  } catch (e) {
    return sendError(res, e);
  }
});

// ===============================
// POST /cash-sessions/:cashSessionId/close
// ===============================
cashRouter.post("/:cashSessionId/close", async (req, res) => {
  try {
    const { cashSessionId } = req.params;
    const { montoDeclarado, observaciones } = req.body || {};

    if (montoDeclarado === undefined || montoDeclarado === null) {
      throw httpError(400, "bad_request", "Faltan campos obligatorios");
    }

    const montoDeclaradoCentavos = toCentavos(montoDeclarado);

    const { rows } = await pool.query(
      `SELECT id, estado, usuario_id,
              monto_inicial_centavos,
              monto_esperado_centavos,
              diferencia_centavos,
              fecha_apertura, fecha_cierre,
              monto_declarado_centavos, observaciones
         FROM cash_sessions
        WHERE id=$1`,
      [cashSessionId]
    );

    const cs = rows[0];
    if (!cs) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    // Permisos:
    // - CAJERO: solo puede cerrar su propia caja
    // - ADMIN: puede cerrar cualquiera
    if (cs.usuario_id !== req.user.id && !isAdmin(req)) {
      return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    }

    if (cs.estado !== "ABIERTA") {
      return res.status(422).json({ error: "cash_session_state_invalid", message: "La caja no está abierta" });
    }

    const expectedCentavos = await computeExpectedCashCentavos(cashSessionId);
    const diffCentavos = montoDeclaradoCentavos - expectedCentavos;

    const { rows: updRows } = await pool.query(
      `UPDATE cash_sessions
         SET estado='CERRADA',
             fecha_cierre=now(),
             monto_declarado_centavos=$2,
             monto_esperado_centavos=$3,
             diferencia_centavos=$4,
            observaciones=$5
      WHERE id=$1
      RETURNING id, estado, fecha_apertura, fecha_cierre, usuario_id,
                monto_inicial_centavos, monto_declarado_centavos, observaciones,
                monto_esperado_centavos, diferencia_centavos`,
      [cashSessionId, montoDeclaradoCentavos, expectedCentavos, diffCentavos, observaciones ?? null]
    );

    return res.json(sanitizeCashSessionRow(updRows[0], req.user.rol));
  } catch (e) {
    return sendError(res, e);
  }
});
