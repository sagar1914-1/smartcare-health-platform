import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getHealth(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      status: "healthy",
      service: "SmartCare API",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(503).json({
      success: false,
      status: "degraded",
      service: "SmartCare API",
      database: "disconnected",
      timestamp: new Date().toISOString()
    });
  }
}
