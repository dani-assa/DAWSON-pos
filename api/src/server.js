import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import YAML from "yaml";

import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { posRouter } from "./routes/pos.js";
import { cashRouter } from "./routes/cash.js";
import { productsAdminRouter } from "./routes/products_admin.js";
import { categoriesAdminRouter } from "./routes/categories_admin.js";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

// Swagger UI
const openapiPath = path.join(process.cwd(), "src", "openapi.yml");
const spec = YAML.parse(fs.readFileSync(openapiPath, "utf8"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));

// Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/clients", clientsRouter);
app.use("/api/v1/pos", posRouter);
app.use("/api/v1/cash-sessions", cashRouter);
app.use("/api/v1", productsAdminRouter);
app.use("/api/v1", categoriesAdminRouter);


app.get("/health", (req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`Swagger UI on http://localhost:${port}/docs`);
});
