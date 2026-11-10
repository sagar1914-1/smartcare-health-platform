import twilio from "twilio";
import {
  PrismaClient,
  NotificationStatus,
} from "@prisma/client";
import { env } from "../../config/env";

type NotificationSummary = {
  total: number;
  sent: number;
  simulated: number;
  failed: number;
  pending: number;
  smsEnabled: boolean;
  mockMode: boolean;
};

export async function sendEmergencyNotifications(
  prisma: PrismaClient,
  userId: string,
  incidentId: string,
  emergencyMessage: string
): Promise<NotificationSummary> {
  // Fetch the user's emergency contacts.
  // Primary contacts are processed first.
  const contacts = await prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: [
      { isPrimary: "desc" },
      { createdAt: "asc" },
    ],
  });

  const mockMode = env.SMS_MODE === "mock";

  const realSmsEnabled =
    env.SMS_MODE === "twilio" &&
    env.TWILIO_SMS_ENABLED;

  const summary: NotificationSummary = {
    total: contacts.length,
    sent: 0,
    simulated: 0,
    failed: 0,
    pending: 0,
    smsEnabled: realSmsEnabled,
    mockMode,
  };

  if (contacts.length === 0) {
    return summary;
  }

  // Initialize Twilio only when real SMS is enabled.
  let twilioClient: ReturnType<typeof twilio> | null = null;

  if (realSmsEnabled) {
    const twilioConfigured =
      Boolean(env.TWILIO_ACCOUNT_SID) &&
      Boolean(env.TWILIO_AUTH_TOKEN) &&
      Boolean(env.TWILIO_FROM_NUMBER);

    if (twilioConfigured) {
      twilioClient = twilio(
        env.TWILIO_ACCOUNT_SID!,
        env.TWILIO_AUTH_TOKEN!
      );
    }
  }

  // Process each emergency contact.
  for (const contact of contacts) {
    // First create a notification record.
    const notification =
      await prisma.emergencyNotification.create({
        data: {
          recipientName: contact.name,
          recipientPhone: contact.phone,
          message: emergencyMessage,
          incidentId,
          contactId: contact.id,
          status: NotificationStatus.PENDING,
        },
      });

    // MOCK MODE:
    // No actual SMS is sent in this mode.
    if (mockMode) {
      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.SIMULATED,
          providerMessageId: `MOCK-${notification.id}`,
          sentAt: null,
          errorMessage:
            "SIMULATED — No real SMS was sent.",
        },
      });

      summary.simulated++;
      continue;
    }

    // SMS OFF MODE:
    // Keep the notification pending.
    if (env.SMS_MODE === "off") {
      summary.pending++;
      continue;
    }

    // REAL SMS MODE:
    // Check whether real SMS is enabled.
    if (!realSmsEnabled) {
      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage:
            "Real SMS is disabled. Enable it only when ready to send actual messages.",
        },
      });

      summary.failed++;
      continue;
    }

    // Check Twilio configuration.
    if (!twilioClient || !env.TWILIO_FROM_NUMBER) {
      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage:
            "Twilio credentials or sender number are not configured.",
        },
      });

      summary.failed++;
      continue;
    }

    // Validate recipient phone number using E.164 format.
    const isValidPhone =
      /^\+[1-9]\d{7,14}$/.test(contact.phone);

    if (!isValidPhone) {
      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage:
            "Invalid phone number. Use E.164 format, for example +919876543210.",
        },
      });

      summary.failed++;
      continue;
    }

    // Attempt to send a real SMS through Twilio.
    try {
      const result = await twilioClient.messages.create({
        body:
          `SmartCare Emergency Alert: An emergency assistance request has been created. Details: ${emergencyMessage}`,
        from: env.TWILIO_FROM_NUMBER,
        to: contact.phone,
      });

      // Twilio accepted the message request.
      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.SENT,
          providerMessageId: result.sid,
          sentAt: new Date(),
          errorMessage: null,
        },
      });

      summary.sent++;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown Twilio delivery error.";

      await prisma.emergencyNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage: errorMessage.slice(0, 1000),
        },
      });

      summary.failed++;
    }
  }

  return summary;
}