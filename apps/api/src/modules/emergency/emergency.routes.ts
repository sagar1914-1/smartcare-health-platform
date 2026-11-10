
import { Router } from "express";
import { authenticate } from "../auth/auth.middleware";

import {
  createIncident,
  getIncidents,
  resolveIncident,
  cancelIncident,
  createEmergencyContact,
  getEmergencyContacts,
  updateEmergencyContact,
  deleteEmergencyContact,
  getEmergencyNotifications,
} from "./emergency.controller";

const router = Router();

// ============================================
// AUTHENTICATION
// ============================================

// All emergency endpoints require authentication.
router.use(authenticate);

// ============================================
// EMERGENCY INCIDENT ROUTES
// ============================================

// Create a new SOS emergency incident
router.post("/incidents", createIncident);

// Get emergency incident history
router.get("/incidents", getIncidents);

// Get emergency notification history
router.get("/notifications", getEmergencyNotifications);

// Resolve an active emergency incident
router.patch("/incidents/:id/resolve", resolveIncident);

// Cancel an active emergency incident
router.patch("/incidents/:id/cancel", cancelIncident);

// ============================================
// EMERGENCY CONTACT ROUTES
// ============================================

// Add a new emergency contact
router.post("/contacts", createEmergencyContact);

// Get all emergency contacts
router.get("/contacts", getEmergencyContacts);

// Update an existing emergency contact
router.patch("/contacts/:id", updateEmergencyContact);

// Delete an emergency contact
router.delete("/contacts/:id", deleteEmergencyContact);

// ============================================
// EXPORT ROUTER
// ============================================

export default router;
