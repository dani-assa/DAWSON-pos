import jwt from "jsonwebtoken";
import { pool } from "../db.js";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is required");
  return s;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "unauthorized", message: "Token inválido o ausente" });

    const payload = jwt.verify(token, getSecret());
    const userId = payload.sub;

    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, r.nombre as rol
       FROM usuarios u JOIN roles r ON r.id=u.rol_id
       WHERE u.id=$1 AND u.activo=true`,
      [userId]
    );
    if (!rows[0]) return res.status(401).json({ error: "unauthorized", message: "Usuario no válido" });

    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: "unauthorized", message: "Token inválido o ausente" });
  }
}

export function requireRole(roleName) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized", message: "Token inválido o ausente" });
    if (req.user.rol !== roleName) return res.status(403).json({ error: "forbidden", message: "No tiene permisos para esta acción" });
    next();
  };
}
