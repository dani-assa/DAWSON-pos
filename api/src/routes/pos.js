import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendError, httpError } from "../errors.js";

export const posRouter = express.Router();
posRouter.use(requireAuth);

// helper: fetch active product by id
async function getActiveProduct(productId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.product_base_id, p.nombre, p.categoria, p.tipo, p.cantidad_descuento, p.precio_venta_centavos,
            p.activo, pb.activo as base_activo, pb.stock_actual
     FROM products p
     JOIN product_bases pb ON pb.id=p.product_base_id
     WHERE p.id=$1`,
    [productId]
  );
  return rows[0] || null;
}

posRouter.get("/products", async (req, res) => {
  try {
    const search = (req.query.search || "").toString().trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));

    const params = [];
    let where = "WHERE p.activo=true AND pb.activo=true";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND p.nombre ILIKE $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT p.id as "productId", p.nombre, p.categoria, p.tipo,
              p.cantidad_descuento as "cantidadDescuento",
              p.precio_venta_centavos as "precioVenta",
              p.activo, p.product_base_id as "productBaseId"
       FROM products p JOIN product_bases pb ON pb.id=p.product_base_id
       ${where}
       ORDER BY p.nombre ASC
       LIMIT ${limit}`,
      params
    );

    return res.json({ items: rows });
  } catch (e) {
    return sendError(res, e);
  }
});

posRouter.get("/products/by-category", async (req, res) => {
  try {
    const categoria = (req.query.categoria || "").toString();
    if (!categoria) throw httpError(400, "bad_request", "Faltan campos obligatorios");
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "100", 10)));

    const { rows } = await pool.query(
      `SELECT p.id as "productId", p.nombre, p.categoria, p.tipo,
              p.cantidad_descuento as "cantidadDescuento",
              p.precio_venta_centavos as "precioVenta",
              p.activo, p.product_base_id as "productBaseId"
       FROM products p JOIN product_bases pb ON pb.id=p.product_base_id
       WHERE p.activo=true AND pb.activo=true AND p.categoria=$1
       ORDER BY p.nombre ASC
       LIMIT ${limit}`,
      [categoria]
    );
    return res.json({ categoria, items: rows });
  } catch (e) {
    return sendError(res, e);
  }
});

posRouter.get("/combos", async (req, res) => {
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

    const countQ = `SELECT COUNT(*)::int AS total FROM combos ${where}`;
    const listQ = `SELECT id as "comboId", nombre, precio_centavos as "precio", activo FROM combos ${where} ORDER BY nombre ASC LIMIT ${pageSize} OFFSET ${offset}`;
    const [{ rows: c }, { rows }] = await Promise.all([pool.query(countQ, params), pool.query(listQ, params)]);
    return res.json({ items: rows, page, pageSize, total: c[0]?.total || 0 });
  } catch (e) {
    return sendError(res, e);
  }
});

// Create draft sale
posRouter.post("/sales/draft", async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const clienteId = body.clienteId;
    const items = Array.isArray(body.items) ? body.items : [];
    const comboItems = Array.isArray(body.comboItems) ? body.comboItems : [];
    const nota = body.nota ?? null;

    if (!clienteId) throw httpError(400, "client_required", "Cliente obligatorio");

    // validate client exists
    const { rows: clientRows } = await pool.query(`SELECT id, nombre, telefono FROM clientes WHERE id=$1`, [clienteId]);
    if (!clientRows[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    // Validate products active (no stock check)
    const productLines = [];
    for (const it of items) {
      const pid = it.productId;
      const qty = Number(it.qty ?? 0);
      if (!pid || !(qty > 0)) continue;
      const p = await getActiveProduct(pid);
      if (!p || !p.activo || !p.base_activo) {
        return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId: pid } });
      }
      const unit = Number(p.precio_venta_centavos);
      const subtotal = unit * qty;
      productLines.push({
        tipo: "PRODUCT",
        productId: pid,
        nombre: p.nombre,
        qty,
        unitPrice: unit,
        subtotal
      });
    }

    // Validate combos & selections exact
    const comboLines = [];
    for (const ci of comboItems) {
      const comboId = ci.comboId;
      if (!comboId) continue;
      const { rows: comboRows } = await pool.query(`SELECT id, nombre, precio_centavos, activo FROM combos WHERE id=$1`, [comboId]);
      const combo = comboRows[0];
      if (!combo || !combo.activo) {
        return res.status(422).json({ error: "product_inactive", message: "Combo inactivo", details: { comboId } });
      }
      const { rows: comps } = await pool.query(`SELECT categoria, cantidad FROM combo_components WHERE combo_id=$1`, [comboId]);
      const selections = Array.isArray(ci.selections) ? ci.selections : [];

      // Build map categoria->productId
      const selMap = new Map();
      for (const s of selections) selMap.set(s.categoria, s.productId);

      const selectionsView = [];
      for (const comp of comps) {
        const productId = selMap.get(comp.categoria);
        if (!productId) {
          return res.status(422).json({
            error: "combo_selection_invalid",
            message: "Falta selección para un componente del combo",
            details: { comboId, categoria: comp.categoria }
          });
        }
        const p = await getActiveProduct(productId);
        if (!p || !p.activo || !p.base_activo) {
          return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId } });
        }
        const required = Number(comp.cantidad);
        const selectedQtyDesc = Number(p.cantidad_descuento);
        if (Math.abs(required - selectedQtyDesc) > 0.0000001) {
          return res.status(422).json({
            error: "combo_selection_invalid",
            message: "La presentación seleccionada no coincide con la cantidad requerida por el combo",
            details: { categoria: comp.categoria, required, selectedCantidadDescuento: selectedQtyDesc }
          });
        }
        selectionsView.push({ categoria: comp.categoria, productId, cantidadDescuento: selectedQtyDesc });
      }

      comboLines.push({
        tipo: "COMBO",
        comboId,
        nombre: combo.nombre,
        qty: 1,
        unitPrice: Number(combo.precio_centavos),
        subtotal: Number(combo.precio_centavos),
        selections: selectionsView
      });
    }

    const subtotal = [...productLines, ...comboLines].reduce((acc, l) => acc + Number(l.subtotal), 0);
    const total = subtotal; // discount reserved
    await client.query("BEGIN");

    // create sale
    const { rows: saleRows } = await client.query(
      `INSERT INTO sales(cliente_id, estado, nota, total_centavos, created_by_user_id)
       VALUES ($1,'DRAFT',$2,$3,$4)
       RETURNING id, created_at`,
      [clienteId, nota, total, req.user.id]
    );
    const saleId = saleRows[0].id;

    // insert lines
    const linesOut = [];
    for (const l of productLines) {
      const { rows } = await client.query(
        `INSERT INTO sale_lines(sale_id, tipo, product_id, qty, unit_price_centavos, subtotal_centavos)
         VALUES ($1,'PRODUCT',$2,$3,$4,$5)
         RETURNING id`,
        [saleId, l.productId, l.qty, l.unitPrice, l.subtotal]
      );
      linesOut.push({ lineId: rows[0].id, ...l });
    }
    for (const l of comboLines) {
      const { rows } = await client.query(
        `INSERT INTO sale_lines(sale_id, tipo, combo_id, qty, unit_price_centavos, subtotal_centavos)
         VALUES ($1,'COMBO',$2,$3,$4,$5)
         RETURNING id`,
        [saleId, l.comboId, l.qty, l.unitPrice, l.subtotal]
      );
      const lineId = rows[0].id;
      // selections
      for (const s of l.selections) {
        await client.query(
          `INSERT INTO sale_combo_selections(sale_id, combo_id, categoria, product_id, cantidad_descuento)
           VALUES ($1,$2,$3,$4,$5)`,
          [saleId, l.comboId, s.categoria, s.productId, s.cantidadDescuento]
        );
      }
      linesOut.push({ lineId, ...l });
    }

    await client.query("COMMIT");

    return res.status(201).json({
      saleId,
      estado: "DRAFT",
      cliente: { id: clientRows[0].id, nombre: clientRows[0].nombre, telefono: clientRows[0].telefono },
      lines: linesOut,
      totals: { subtotal, discount: 0, total },
      nota: nota ?? undefined,
      createdAt: saleRows[0].created_at,
      createdByUserId: req.user.id,
      paidByUserId: null
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return sendError(res, e);
  } finally {
    client.release();
  }
});

// Update draft
posRouter.put("/sales/:saleId/draft", async (req, res) => {
  const client = await pool.connect();
  try {
    const { saleId } = req.params;
    const body = req.body || {};

    const { rows: saleRows } = await pool.query(`SELECT id, estado FROM sales WHERE id=$1`, [saleId]);
    const sale = saleRows[0];
    if (!sale) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    if (sale.estado !== "DRAFT") return res.status(422).json({ error: "sale_state_invalid", message: "Estado de venta inválido" });

    // delete old lines & selections, then reuse create logic inline:
    await client.query("BEGIN");
    await client.query(`DELETE FROM sale_combo_selections WHERE sale_id=$1`, [saleId]);
    await client.query(`DELETE FROM sale_lines WHERE sale_id=$1`, [saleId]);

    // set clienteId/nota
    const clienteId = body.clienteId;
    const nota = body.nota ?? null;
    if (!clienteId) throw httpError(400, "client_required", "Cliente obligatorio");

    const { rows: cl } = await pool.query(`SELECT id, nombre, telefono FROM clientes WHERE id=$1`, [clienteId]);
    if (!cl[0]) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const items = Array.isArray(body.items) ? body.items : [];
    const comboItems = Array.isArray(body.comboItems) ? body.comboItems : [];

    const productLines = [];
    for (const it of items) {
      const pid = it.productId;
      const qty = Number(it.qty ?? 0);
      if (!pid || !(qty > 0)) continue;
      const p = await getActiveProduct(pid);
      if (!p || !p.activo || !p.base_activo) {
        return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId: pid } });
      }
      const unit = Number(p.precio_venta_centavos);
      const subtotal = unit * qty;
      productLines.push({ tipo: "PRODUCT", productId: pid, nombre: p.nombre, qty, unitPrice: unit, subtotal });
    }

    const comboLines = [];
    for (const ci of comboItems) {
      const comboId = ci.comboId;
      if (!comboId) continue;
      const { rows: comboRows } = await pool.query(`SELECT id, nombre, precio_centavos, activo FROM combos WHERE id=$1`, [comboId]);
      const combo = comboRows[0];
      if (!combo || !combo.activo) {
        return res.status(422).json({ error: "product_inactive", message: "Combo inactivo", details: { comboId } });
      }
      const { rows: comps } = await pool.query(`SELECT categoria, cantidad FROM combo_components WHERE combo_id=$1`, [comboId]);
      const selections = Array.isArray(ci.selections) ? ci.selections : [];
      const selMap = new Map();
      for (const s of selections) selMap.set(s.categoria, s.productId);

      const selectionsView = [];
      for (const comp of comps) {
        const productId = selMap.get(comp.categoria);
        if (!productId) {
          return res.status(422).json({ error: "combo_selection_invalid", message: "Falta selección para un componente del combo", details: { comboId, categoria: comp.categoria } });
        }
        const p = await getActiveProduct(productId);
        if (!p || !p.activo || !p.base_activo) {
          return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId } });
        }
        const required = Number(comp.cantidad);
        const selectedQtyDesc = Number(p.cantidad_descuento);
        if (Math.abs(required - selectedQtyDesc) > 0.0000001) {
          return res.status(422).json({ error: "combo_selection_invalid", message: "La presentación seleccionada no coincide con la cantidad requerida por el combo", details: { categoria: comp.categoria, required, selectedCantidadDescuento: selectedQtyDesc } });
        }
        selectionsView.push({ categoria: comp.categoria, productId, cantidadDescuento: selectedQtyDesc });
      }

      comboLines.push({ tipo: "COMBO", comboId, nombre: combo.nombre, qty: 1, unitPrice: Number(combo.precio_centavos), subtotal: Number(combo.precio_centavos), selections: selectionsView });
    }

    const subtotal = [...productLines, ...comboLines].reduce((acc, l) => acc + Number(l.subtotal), 0);
    const total = subtotal;

    // update sale header
    await client.query(`UPDATE sales SET cliente_id=$2, nota=$3, total_centavos=$4 WHERE id=$1`, [saleId, clienteId, nota, total]);

    const linesOut = [];
    for (const l of productLines) {
      const { rows } = await client.query(
        `INSERT INTO sale_lines(sale_id, tipo, product_id, qty, unit_price_centavos, subtotal_centavos)
         VALUES ($1,'PRODUCT',$2,$3,$4,$5)
         RETURNING id`,
        [saleId, l.productId, l.qty, l.unitPrice, l.subtotal]
      );
      linesOut.push({ lineId: rows[0].id, ...l });
    }
    for (const l of comboLines) {
      const { rows } = await client.query(
        `INSERT INTO sale_lines(sale_id, tipo, combo_id, qty, unit_price_centavos, subtotal_centavos)
         VALUES ($1,'COMBO',$2,$3,$4,$5)
         RETURNING id`,
        [saleId, l.comboId, l.qty, l.unitPrice, l.subtotal]
      );
      const lineId = rows[0].id;
      for (const s of l.selections) {
        await client.query(
          `INSERT INTO sale_combo_selections(sale_id, combo_id, categoria, product_id, cantidad_descuento)
           VALUES ($1,$2,$3,$4,$5)`,
          [saleId, l.comboId, s.categoria, s.productId, s.cantidadDescuento]
        );
      }
      linesOut.push({ lineId, ...l });
    }

    await client.query("COMMIT");

    return res.json({
      saleId,
      estado: "DRAFT",
      cliente: { id: cl[0].id, nombre: cl[0].nombre, telefono: cl[0].telefono },
      lines: linesOut,
      totals: { subtotal, discount: 0, total },
      nota: nota ?? undefined,
      createdAt: new Date().toISOString(),
      createdByUserId: req.user.id
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return sendError(res, e);
  } finally {
    client.release();
  }
});

// Get sale
posRouter.get("/sales/:saleId", async (req, res) => {
  try {
    const { saleId } = req.params;
    const { rows: hdr } = await pool.query(
      `SELECT s.id, s.estado, s.nota, s.total_centavos, s.created_at, s.held_at, s.paid_at, s.created_by_user_id, s.paid_by_user_id,
              c.id as cliente_id, c.nombre as cliente_nombre, c.telefono as cliente_telefono
       FROM sales s JOIN clientes c ON c.id=s.cliente_id
       WHERE s.id=$1`,
      [saleId]
    );
    const h = hdr[0];
    if (!h) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });

    const { rows: lines } = await pool.query(`SELECT * FROM sale_lines WHERE sale_id=$1 ORDER BY created_at ASC NULLS LAST`, [saleId]).catch(async () => {
      return { rows: await (await pool.query(`SELECT * FROM sale_lines WHERE sale_id=$1`, [saleId])).rows };
    });

    // Build view
    const outLines = [];
    for (const l of lines) {
      if (l.tipo === "PRODUCT") {
        const { rows: p } = await pool.query(`SELECT nombre FROM products WHERE id=$1`, [l.product_id]);
        outLines.push({
          lineId: l.id,
          tipo: "PRODUCT",
          productId: l.product_id,
          nombre: p[0]?.nombre ?? "Producto",
          qty: Number(l.qty),
          unitPrice: Number(l.unit_price_centavos),
          subtotal: Number(l.subtotal_centavos),
        });
      } else {
        const { rows: cb } = await pool.query(`SELECT nombre FROM combos WHERE id=$1`, [l.combo_id]);
        const { rows: sels } = await pool.query(`SELECT categoria, product_id, cantidad_descuento FROM sale_combo_selections WHERE sale_id=$1 AND combo_id=$2`, [saleId, l.combo_id]);
        outLines.push({
          lineId: l.id,
          tipo: "COMBO",
          comboId: l.combo_id,
          nombre: cb[0]?.nombre ?? "Combo",
          qty: Number(l.qty),
          unitPrice: Number(l.unit_price_centavos),
          subtotal: Number(l.subtotal_centavos),
          selections: sels.map(s => ({ categoria: s.categoria, productId: s.product_id, cantidadDescuento: Number(s.cantidad_descuento) }))
        });
      }
    }

    return res.json({
      saleId: h.id,
      estado: h.estado,
      cliente: { id: h.cliente_id, nombre: h.cliente_nombre, telefono: h.cliente_telefono },
      lines: outLines,
      totals: { subtotal: Number(h.total_centavos), discount: 0, total: Number(h.total_centavos) },
      nota: h.nota ?? undefined,
      createdAt: h.created_at,
      heldAt: h.held_at,
      paidAt: h.paid_at,
      createdByUserId: h.created_by_user_id,
      paidByUserId: h.paid_by_user_id
    });
  } catch (e) {
    return sendError(res, e);
  }
});

// Hold sale
posRouter.post("/sales/:saleId/hold", async (req, res) => {
  try {
    const { saleId } = req.params;
    const nota = (req.body || {}).nota ?? null;

    const { rows } = await pool.query(`SELECT id, estado FROM sales WHERE id=$1`, [saleId]);
    const sale = rows[0];
    if (!sale) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    if (sale.estado !== "DRAFT") return res.status(422).json({ error: "sale_state_invalid", message: "Estado de venta inválido" });

    const { rows: upd } = await pool.query(
      `UPDATE sales SET estado='PENDIENTE', held_at=now(), nota=COALESCE($2,nota) WHERE id=$1
       RETURNING id as "saleId", estado, held_at as "heldAt"`,
      [saleId, nota]
    );

    await pool.query(
      `INSERT INTO audit_log(usuario_id, accion, entidad, entidad_id, metadata) VALUES ($1,'SALE_HELD','sale',$2,$3)`,
      [req.user.id, saleId, JSON.stringify({})]
    );

    return res.json(upd[0]);
  } catch (e) {
    return sendError(res, e);
  }
});

// Pay sale (validate stock, combos exact)
posRouter.post("/sales/:saleId/pay", async (req, res) => {
  const client = await pool.connect();
  try {
    const { saleId } = req.params;
    const { cashSessionId, payments, emitirFactura } = req.body || {};
    if (!cashSessionId || !Array.isArray(payments) || payments.length === 0) {
      throw httpError(422, "bad_request", "Faltan campos obligatorios");
    }

    // verify cash session open and belongs to payer
    const { rows: csRows } = await pool.query(`SELECT id, estado, usuario_id FROM cash_sessions WHERE id=$1`, [cashSessionId]);
    const cs = csRows[0];
    if (!cs) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    if (cs.usuario_id !== req.user.id) return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    if (cs.estado !== "ABIERTA") return res.status(422).json({ error: "cash_session_state_invalid", message: "La caja no está abierta" });

    const { rows: saleRows } = await pool.query(`SELECT id, estado, total_centavos, created_by_user_id FROM sales WHERE id=$1`, [saleId]);
    const sale = saleRows[0];
    if (!sale) return res.status(404).json({ error: "not_found", message: "Recurso no encontrado" });
    if (sale.estado !== "PENDIENTE" && sale.estado !== "DRAFT") {
      return res.status(422).json({ error: "sale_state_invalid", message: "Estado de venta inválido" });
    }

    const total = Number(sale.total_centavos);
    const sumPayments = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    if (sumPayments !== total) {
      return res.status(422).json({ error: "payments_mismatch", message: "La suma de pagos no coincide con el total", details: { total, sumPayments } });
    }

    // Gather requirements per product_base
    // 1) product lines: qty * cantidad_descuento
    // 2) combo selections: require exact match already validated; discount = component cantidad
    const { rows: lines } = await pool.query(`SELECT * FROM sale_lines WHERE sale_id=$1`, [saleId]);
    const requiredMap = new Map(); // pbId -> required numeric
    const stockInfo = new Map(); // pbId -> {available}
    // Validate products active at pay time and compute requirements
    for (const l of lines) {
      if (l.tipo === "PRODUCT") {
        const p = await getActiveProduct(l.product_id);
        if (!p || !p.activo || !p.base_activo) {
          return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId: l.product_id } });
        }
        const reqQty = Number(l.qty) * Number(p.cantidad_descuento);
        requiredMap.set(p.product_base_id, (requiredMap.get(p.product_base_id) || 0) + reqQty);
        stockInfo.set(p.product_base_id, { available: Number(p.stock_actual) });
      } else {
        // combo: check selections exact against components
        const { rows: combo } = await pool.query(`SELECT activo FROM combos WHERE id=$1`, [l.combo_id]);
        if (!combo[0]?.activo) {
          return res.status(422).json({ error: "product_inactive", message: "Combo inactivo", details: { comboId: l.combo_id } });
        }
        const { rows: comps } = await pool.query(`SELECT categoria, cantidad FROM combo_components WHERE combo_id=$1`, [l.combo_id]);
        const { rows: sels } = await pool.query(`SELECT categoria, product_id, cantidad_descuento FROM sale_combo_selections WHERE sale_id=$1 AND combo_id=$2`, [saleId, l.combo_id]);

        const selMap = new Map();
        for (const s of sels) selMap.set(s.categoria, s);

        for (const comp of comps) {
          const sel = selMap.get(comp.categoria);
          if (!sel) {
            return res.status(422).json({ error: "combo_selection_invalid", message: "Falta selección para un componente del combo", details: { comboId: l.combo_id, categoria: comp.categoria } });
          }
          const p = await getActiveProduct(sel.product_id);
          if (!p || !p.activo || !p.base_activo) {
            return res.status(422).json({ error: "product_inactive", message: "Producto inactivo", details: { productId: sel.product_id } });
          }
          const required = Number(comp.cantidad);
          const selectedQtyDesc = Number(sel.cantidad_descuento);
          if (Math.abs(required - selectedQtyDesc) > 0.0000001) {
            return res.status(422).json({ error: "combo_selection_invalid", message: "La presentación seleccionada no coincide con la cantidad requerida por el combo", details: { categoria: comp.categoria, required, selectedCantidadDescuento: selectedQtyDesc } });
          }
          requiredMap.set(p.product_base_id, (requiredMap.get(p.product_base_id) || 0) + required);
          if (!stockInfo.has(p.product_base_id)) stockInfo.set(p.product_base_id, { available: Number(p.stock_actual) });
        }
      }
    }

    // Check stock sufficient
    const insufficient = [];
    for (const [pbId, required] of requiredMap.entries()) {
      const { rows: pb } = await pool.query(`SELECT stock_actual FROM product_bases WHERE id=$1`, [pbId]);
      const available = Number(pb[0]?.stock_actual ?? 0);
      if (available + 1e-9 < required) insufficient.push({ productBaseId: pbId, required, available });
    }
    if (insufficient.length) {
      return res.status(409).json({ error: "stock_insufficient", message: "Stock insuficiente", details: insufficient });
    }

    await client.query("BEGIN");

    // ensure sale is PENDIENTE; if DRAFT pay directly to PAGADA (allowed)
    if (sale.estado === "DRAFT") {
      await client.query(`UPDATE sales SET estado='PENDIENTE', held_at=now() WHERE id=$1`, [saleId]);
    }

    // Insert payments
    for (const p of payments) {
      await client.query(
        `INSERT INTO sale_payments(sale_id, medio, amount_centavos) VALUES ($1,$2,$3)`,
        [saleId, p.medio, p.amount]
      );
    }

    // Deduct stock & insert movements
    for (const [pbId, required] of requiredMap.entries()) {
      await client.query(`UPDATE product_bases SET stock_actual = stock_actual - $2 WHERE id=$1`, [pbId, required]);
      await client.query(
        `INSERT INTO stock_movements(product_base_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
         VALUES ($1,'VENTA',$2,'SALE',$3,$4)`,
        [pbId, -required, saleId, req.user.id]
      );
    }

    // Update sale status
    const { rows: upd } = await client.query(
      `UPDATE sales
       SET estado='PAGADA', paid_at=now(), cash_session_id=$2, paid_by_user_id=$3
       WHERE id=$1
       RETURNING id as "saleId", estado, paid_at as "paidAt", created_by_user_id as "createdByUserId", paid_by_user_id as "paidByUserId", total_centavos`,
      [saleId, cashSessionId, req.user.id]
    );

    // audit
    await client.query(
      `INSERT INTO audit_log(usuario_id, accion, entidad, entidad_id, metadata)
       VALUES ($1,'SALE_PAID','sale',$2,$3)`,
      [req.user.id, saleId, JSON.stringify({ createdByUserId: sale.created_by_user_id, paidByUserId: req.user.id, cashSessionId, emitirFactura: !!emitirFactura })]
    );

    await client.query("COMMIT");

    return res.json({
      saleId,
      estado: "PAGADA",
      paidAt: upd[0].paidAt,
      createdByUserId: upd[0].createdByUserId,
      paidByUserId: upd[0].paidByUserId,
      payments: payments.map(p => ({ medio: p.medio, amount: Number(p.amount) })),
      totals: { subtotal: total, discount: 0, total }
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return sendError(res, e);
  } finally {
    client.release();
  }
});
