import { Response } from "express";
import {
  PrismaClient,
  IncidentStatus,
} from "@prisma/client";
import { z } from "zod";
import { AuthRequest } from "../auth/auth.middleware";
import { sendEmergencyNotifications } from "./notification.service";

const prisma = new PrismaClient();

// ============================================
// EMERGENCY INCIDENT VALIDATION
// ============================================

const createIncidentSchema = z
  .object({
    message: z.string().trim().max(500).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .refine(
    (data) =>
      (data.latitude === undefined && data.longitude === undefined) ||
      (data.latitude !== undefined && data.longitude !== undefined),
    {
      message: "Latitude and longitude must be provided together.",
    }
  );

// ============================================
// EMERGENCY CONTACT VALIDATION
// ============================================

function isValidPhoneNumber(phone: string): boolean {
  const value = phone.trim();

  // Count numeric digits without relying on regular-expression escaping.
  const digitCount = [...value].filter(
    (character) => character >= "0" && character <= "9"
  ).length;

  // Permit digits, spaces, parentheses, hyphens, periods, and a leading +.
  const allowedCharacters = "0123456789 +().-";
  const hasOnlyAllowedCharacters = [...value].every((character) =>
    allowedCharacters.includes(character)
  );

  const plusCount = [...value].filter((character) => character === "+").length;
  const plusIsValid =
    plusCount === 0 || (plusCount === 1 && value.startsWith("+"));

  return (
    hasOnlyAllowedCharacters &&
    plusIsValid &&
    digitCount >= 7 &&
    digitCount <= 15
  );
}

const phoneNumberSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .refine(isValidPhoneNumber, {
    message: "Enter a valid phone number containing 7 to 15 digits.",
  });

const createContactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneNumberSchema,
  relationship: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

const updateContactSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: phoneNumberSchema.optional(),
    relationship: z.string().trim().max(50).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

// ============================================
// HELPER: AUTHENTICATION CHECK
// ============================================

function getUserId(req: AuthRequest): string | null {
  return req.user?.userId || null;
}

// ============================================
// CREATE EMERGENCY INCIDENT + NOTIFICATIONS
// ============================================

export async function createIncident(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const parsed = createIncidentSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid emergency incident details",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { message, latitude, longitude } = parsed.data;

    const emergencyMessage =
      message || "Emergency assistance requested by user.";

    // Save the incident before processing notifications.
    const incident = await prisma.emergencyIncident.create({
      data: {
        message: emergencyMessage,
        latitude,
        longitude,
        status: IncidentStatus.ACTIVE,
        userId,
      },
    });

    // Process notifications without allowing notification
    // failures to cancel the successfully created incident.
    let notificationSummary: {
      total: number;
      sent: number;
      failed: number;
      pending: number;
      smsEnabled: boolean;
    } = {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      smsEnabled: false,
    };

    try {
      notificationSummary = await sendEmergencyNotifications(
        prisma,
        userId,
        incident.id,
        emergencyMessage
      );
    } catch (notificationError) {
      console.error(
        "Emergency notification processing error:",
        notificationError
      );
    }

    res.status(201).json({
      success: true,
      message: "Emergency incident created successfully",
      data: incident,
      notifications: notificationSummary,
    });
  } catch (error) {
    console.error("Create emergency incident error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create emergency incident",
    });
  }
}

// ============================================
// GET EMERGENCY INCIDENT HISTORY
// ============================================

export async function getIncidents(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const incidents = await prisma.emergencyIncident.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Emergency incidents retrieved successfully",
      count: incidents.length,
      data: incidents,
    });
  } catch (error) {
    console.error("Get emergency incidents error:", error);

    res.status(500).json({
      success: false,
      message: "Could not retrieve emergency incidents",
    });
  }
}

// ============================================
// UPDATE INCIDENT STATUS
// ============================================

async function updateIncidentStatus(
  req: AuthRequest,
  res: Response,
  newStatus: IncidentStatus
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const incidentId = req.params.id;

    if (typeof incidentId !== "string" || !incidentId.trim()) {
      res.status(400).json({
        success: false,
        message: "Invalid incident ID",
      });
      return;
    }

    const existingIncident = await prisma.emergencyIncident.findFirst({
      where: {
        id: incidentId,
        userId,
      },
    });

    if (!existingIncident) {
      res.status(404).json({
        success: false,
        message: "Emergency incident not found",
      });
      return;
    }

    if (existingIncident.status !== IncidentStatus.ACTIVE) {
      res.status(400).json({
        success: false,
        message: "Only active incidents can be updated",
      });
      return;
    }

    const incident = await prisma.emergencyIncident.update({
      where: { id: incidentId },
      data: {
        status: newStatus,
        resolvedAt: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message:
        newStatus === IncidentStatus.RESOLVED
          ? "Emergency incident resolved successfully"
          : "Emergency incident cancelled successfully",
      data: incident,
    });
  } catch (error) {
    console.error("Update emergency incident error:", error);

    res.status(500).json({
      success: false,
      message: "Could not update emergency incident",
    });
  }
}

// ============================================
// RESOLVE INCIDENT
// ============================================

export async function resolveIncident(
  req: AuthRequest,
  res: Response
): Promise<void> {
  await updateIncidentStatus(
    req,
    res,
    IncidentStatus.RESOLVED
  );
}

// ============================================
// CANCEL INCIDENT
// ============================================

export async function cancelIncident(
  req: AuthRequest,
  res: Response
): Promise<void> {
  await updateIncidentStatus(
    req,
    res,
    IncidentStatus.CANCELLED
  );
}

// ============================================
// CREATE EMERGENCY CONTACT
// ============================================

export async function createEmergencyContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const parsed = createContactSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid emergency contact details",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const {
      name,
      phone,
      relationship,
      isPrimary = false,
    } = parsed.data;

    const contact = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.emergencyContact.updateMany({
          where: { userId },
          data: { isPrimary: false },
        });
      }

      return tx.emergencyContact.create({
        data: {
          name,
          phone,
          relationship,
          isPrimary,
          userId,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: "Emergency contact added successfully",
      data: contact,
    });
  } catch (error) {
    console.error("Create emergency contact error:", error);

    res.status(500).json({
      success: false,
      message: "Could not add emergency contact",
    });
  }
}

// ============================================
// GET EMERGENCY CONTACTS
// ============================================

export async function getEmergencyContacts(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const contacts = await prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: [
        { isPrimary: "desc" },
        { createdAt: "desc" },
      ],
    });

    res.status(200).json({
      success: true,
      message: "Emergency contacts retrieved successfully",
      count: contacts.length,
      data: contacts,
    });
  } catch (error) {
    console.error("Get emergency contacts error:", error);

    res.status(500).json({
      success: false,
      message: "Could not retrieve emergency contacts",
    });
  }
}

// ============================================
// UPDATE EMERGENCY CONTACT
// ============================================

export async function updateEmergencyContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const contactId = req.params.id;

    if (typeof contactId !== "string" || !contactId.trim()) {
      res.status(400).json({
        success: false,
        message: "Invalid contact ID",
      });
      return;
    }

    const parsed = updateContactSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid emergency contact details",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const existingContact = await prisma.emergencyContact.findFirst({
      where: {
        id: contactId,
        userId,
      },
    });

    if (!existingContact) {
      res.status(404).json({
        success: false,
        message: "Emergency contact not found",
      });
      return;
    }

    const contact = await prisma.$transaction(async (tx) => {
      if (parsed.data.isPrimary === true) {
        await tx.emergencyContact.updateMany({
          where: {
            userId,
            id: { not: contactId },
          },
          data: { isPrimary: false },
        });
      }

      return tx.emergencyContact.update({
        where: { id: contactId },
        data: parsed.data,
      });
    });

    res.status(200).json({
      success: true,
      message: "Emergency contact updated successfully",
      data: contact,
    });
  } catch (error) {
    console.error("Update emergency contact error:", error);

    res.status(500).json({
      success: false,
      message: "Could not update emergency contact",
    });
  }
}

// ============================================
// DELETE EMERGENCY CONTACT
// ============================================

export async function deleteEmergencyContact(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const contactId = req.params.id;

    if (typeof contactId !== "string" || !contactId.trim()) {
      res.status(400).json({
        success: false,
        message: "Invalid contact ID",
      });
      return;
    }

    const result = await prisma.emergencyContact.deleteMany({
      where: {
        id: contactId,
        userId,
      },
    });

    if (result.count === 0) {
      res.status(404).json({
        success: false,
        message: "Emergency contact not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Emergency contact deleted successfully",
    });
  } catch (error) {
    console.error("Delete emergency contact error:", error);

    res.status(500).json({
      success: false,
      message: "Could not delete emergency contact",
    });
  }
}

// ============================================
// GET EMERGENCY NOTIFICATION HISTORY
// ============================================

export async function getEmergencyNotifications(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const notifications =
      await prisma.emergencyNotification.findMany({
        where: {
          incident: {
            userId,
          },
        },
        select: {
          id: true,
          recipientName: true,
          recipientPhone: true,
          channel: true,
          status: true,
          message: true,
          providerMessageId: true,
          errorMessage: true,
          sentAt: true,
          createdAt: true,
          incidentId: true,
          incident: {
            select: {
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    res.status(200).json({
      success: true,
      message: "Emergency notification history retrieved successfully",
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error(
      "Get emergency notifications error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Could not retrieve emergency notification history",
    });
  }
}
