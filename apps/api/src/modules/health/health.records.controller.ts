
import { Response } from "express";
import { HealthMetric } from "@prisma/client";
import { z } from "zod";
import { AuthRequest } from "../auth/auth.middleware";
import { prisma } from "../../lib/prisma";

const createHealthRecordSchema = z.object({
  metric: z.nativeEnum(HealthMetric),
  value: z.number().finite(),
  systolic: z.number().int().min(50).max(300).optional(),
  diastolic: z.number().int().min(30).max(200).optional(),
  unit: z.string().trim().min(1).max(20),
  notes: z.string().trim().max(500).optional(),
  recordedAt: z.coerce.date().optional(),
}).superRefine((data, ctx) => {
  if (data.metric === HealthMetric.BLOOD_PRESSURE) {
    if (data.systolic === undefined || data.diastolic === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Blood pressure requires both systolic and diastolic values.", path: ["systolic"] });
    }
    if (data.unit !== "mmHg") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Blood pressure must use mmHg.", path: ["unit"] });
    }
  } else if (data.systolic !== undefined || data.diastolic !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Systolic and diastolic values are only valid for blood pressure records." });
  }
});

// CREATE HEALTH RECORD
export async function createHealthRecord(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const parsed = createHealthRecordSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid health record details",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { metric, value, systolic, diastolic, unit, notes, recordedAt } = parsed.data;

    const record = await prisma.healthRecord.create({
      data: {
        metric,
        value,
        systolic,
        diastolic,
        unit,
        notes,
        recordedAt,
        userId: req.user.userId,
      },
    });

    res.status(201).json({
      success: true,
      message: "Health record created successfully",
      data: record,
    });
  } catch (error) {
    console.error("Create health record error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create health record",
    });
  }
}

// GET ALL HEALTH RECORDS
export async function getHealthRecords(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const records = await prisma.healthRecord.findMany({
      where: {
        userId: req.user.userId,
      },
      orderBy: {
        recordedAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      message: "Health records retrieved successfully",
      count: records.length,
      data: records,
    });
  } catch (error) {
    console.error("Get health records error:", error);

    res.status(500).json({
      success: false,
      message: "Could not retrieve health records",
    });
  }
}

// DELETE HEALTH RECORD
export async function deleteHealthRecord(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const paramId = req.params.id;

    if (typeof paramId !== "string" || !paramId.trim()) {
      res.status(400).json({
        success: false,
        message: "Invalid health record ID",
      });
      return;
    }

    const recordId = paramId.trim();

    const result = await prisma.healthRecord.deleteMany({
      where: {
        id: recordId,
        userId: req.user.userId,
      },
    });

    if (result.count === 0) {
      res.status(404).json({
        success: false,
        message: "Health record not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Health record deleted successfully",
    });
  } catch (error) {
    console.error("Delete health record error:", error);

    res.status(500).json({
      success: false,
      message: "Could not delete health record",
    });
  }
}
