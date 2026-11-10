
import { Router } from "express";

import { getHealth } from "./health.controller";

import {
  createHealthRecord,
  getHealthRecords,
  deleteHealthRecord,
} from "./health.records.controller";

import { authenticate } from "../auth/auth.middleware";

const router = Router();

// API health check
router.get("/", getHealth);

// Protected health record routes
router.post("/records", authenticate, createHealthRecord);

router.get("/records", authenticate, getHealthRecords);

router.delete("/records/:id", authenticate, deleteHealthRecord);

export default router;
