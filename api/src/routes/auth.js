import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { sendError, httpError } from "../errors.js";
import { requireAuth } from "../middlewares/auth.js";

export const authRouter = express.Router();

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is required");
  return s;
}

authRouter.post("/login", async (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) throw httpError(400, "bad_request", "Faltan campos obligatorios");

    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.password_hash, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id=u.rol_id
       WHERE u.usuario=$1 AND u.activo=true`,
      [usuario]
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: "unauthorized", message: "Credenciales inválidas" });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "unauthorized", message: "Credenciales inválidas" });

    const token = jwt.sign({ rol: u.rol }, getSecret(), { subject: u.id, expiresIn: "12h" });
    return res.json({ token, user: { id: u.id, nombre: u.nombre, rol: u.rol } });
  } catch (e) {
    return sendError(res, e);
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  return res.json({ id: req.user.id, nombre: req.user.nombre, rol: req.user.rol });
});
