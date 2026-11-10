
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env";
import healthRoutes from "./modules/health/health.routes";
import authRoutes from "./modules/auth/auth.routes";
import emergencyRoutes from "./modules/emergency/emergency.routes";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGIN,
  })
);

app.use(express.json());

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/emergency", emergencyRoutes);

export default app;
