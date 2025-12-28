export function httpError(status, error, message, details = undefined) {
  return { status, body: { error, message, ...(details ? { details } : {}) } };
}

export function sendError(res, err) {
  if (err && typeof err === "object" && "status" in err && "body" in err) {
    return res.status(err.status).json(err.body);
  }
  console.error(err);
  return res.status(500).json({ error: "internal_error", message: "Error interno" });
}
