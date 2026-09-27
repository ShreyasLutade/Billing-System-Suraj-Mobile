import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  getPeriodRange,
  isActivityPeriod,
  periodLabel,
  toDateFilter,
  type ActivityPeriod,
} from "../lib/period";
import { requireAdmin } from "../middleware/auth";
import { buildRepairSlipPdf } from "../services/repairSlip";

export const repairsRouter = Router();

/** Separate job-number series for the repair desk (InvoiceSequence row 3). */
const REPAIR_SEQUENCE_ID = 3;

/**
 * Photos are compressed in the browser (max 1280px, WebP) before upload, so a
 * real photo is ~80–200 KB. The cap stops an uncompressed original from being
 * stored and filling the volume.
 */
const MAX_PHOTO_BYTES = 600 * 1024;
const PHOTO_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 2 },
  fileFilter: (_req, file, cb) => {
    cb(null, PHOTO_TYPES.has(file.mimetype));
  },
});

const PLATFORMS = ["IOS", "ANDROID"] as const;
const CONDITIONS = ["LIKE_NEW", "GOOD", "FAIR", "DAMAGED", "DEAD"] as const;
const STATUSES = ["RECEIVED", "REPAIRED", "DELIVERED"] as const;
const OUTCOMES = ["FIXED", "NOT_FIXED"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

/** "", missing or null → null; otherwise a non-negative rupee amount. */
const optionalAmount = z.preprocess(
  (value) =>
    value === "" || value === undefined || value === null ? null : Number(value),
  z
    .number({ invalid_type_error: "Enter a valid amount" })
    .min(0, "Amount can't be negative")
    .max(10_000_000)
    .nullable(),
);

const createRepairSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the customer name").max(100),
  customerPhone: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().length(10, "Enter a valid 10-digit mobile number")),
  customerAddress: optionalText(200),
  deviceName: z.string().trim().min(2, "Enter the phone name").max(100),
  platform: z.enum(PLATFORMS, {
    errorMap: () => ({ message: "Choose iOS or Android" }),
  }),
  color: z
    .string({ required_error: "Enter the colour" })
    .trim()
    .min(1, "Enter the colour")
    .max(40),
  ram: optionalText(20),
  storage: optionalText(20),
  condition: z.enum(CONDITIONS).optional(),
  conditionNotes: optionalText(500),
  problemDescription: z
    .string({ required_error: "Describe the problem" })
    .trim()
    .min(3, "Describe the problem")
    .max(1000),
  estimatedCost: optionalAmount,
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  outcome: z.enum(OUTCOMES).optional(),
  finalCharge: optionalAmount.optional(),
  repairNotes: optionalText(1000),
});

/** List/detail fields — never the photo bytes. */
const repairSelect = {
  id: true,
  jobNumber: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  deviceName: true,
  platform: true,
  color: true,
  ram: true,
  storage: true,
  condition: true,
  conditionNotes: true,
  problemDescription: true,
  estimatedCost: true,
  finalCharge: true,
  status: true,
  outcome: true,
  repairNotes: true,
  repairedAt: true,
  deliveredAt: true,
  frontPhotoType: true,
  backPhotoType: true,
  createdByName: true,
  createdAt: true,
} as const;

type RepairRow = {
  frontPhotoType: string | null;
  backPhotoType: string | null;
  createdAt: Date;
  repairedAt: Date | null;
  deliveredAt: Date | null;
} & Record<string, unknown>;

function mapRepair<T extends RepairRow>(row: T) {
  const { frontPhotoType, backPhotoType, createdAt, repairedAt, deliveredAt, ...rest } = row;
  return {
    ...rest,
    condition: rest.condition ? rest.condition : null,
    hasFrontPhoto: Boolean(frontPhotoType),
    hasBackPhoto: Boolean(backPhotoType),
    createdAt: createdAt.toISOString(),
    repairedAt: repairedAt ? repairedAt.toISOString() : null,
    deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
  };
}

repairsRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const digits = q.replace(/\D/g, "");
    const statusParam = String(req.query.status || "").toUpperCase();
    const status = (STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : null;

    const rows = await prisma.repairJob.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { customerName: { contains: q } },
                { deviceName: { contains: q } },
                { problemDescription: { contains: q } },
                { jobNumber: { contains: q.toUpperCase() } },
                ...(digits ? [{ customerPhone: { contains: digits } }] : []),
              ],
            }
          : {}),
      },
      select: repairSelect,
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    res.json({ data: rows.map(mapRepair) });
  } catch (error) {
    next(error);
  }
});

/**
 * Repair sales for a period. A sale counts when the phone is delivered (money
 * collected); "in shop" figures are current, not period-bound.
 */
repairsRouter.get("/analytics", requireAdmin, async (req, res, next) => {
  try {
    const period: ActivityPeriod = isActivityPeriod(req.query.period)
      ? req.query.period
      : "month";
    const range = getPeriodRange(period);

    const [delivered, received, fixed, notFixed, waiting, ready, topDevices, recent] =
      await Promise.all([
        prisma.repairJob.aggregate({
          where: { status: "DELIVERED", deliveredAt: toDateFilter(range) },
          _count: { _all: true },
          _sum: { finalCharge: true },
        }),
        prisma.repairJob.count({ where: { createdAt: toDateFilter(range) } }),
        prisma.repairJob.count({
          where: { outcome: "FIXED", repairedAt: toDateFilter(range) },
        }),
        prisma.repairJob.count({
          where: { outcome: "NOT_FIXED", repairedAt: toDateFilter(range) },
        }),
        prisma.repairJob.count({ where: { status: "RECEIVED" } }),
        prisma.repairJob.aggregate({
          where: { status: "REPAIRED" },
          _count: { _all: true },
          _sum: { finalCharge: true },
        }),
        prisma.repairJob.groupBy({
          by: ["deviceName"],
          where: { createdAt: toDateFilter(range) },
          _count: { _all: true },
          orderBy: { _count: { deviceName: "desc" } },
          take: 5,
        }),
        prisma.repairJob.findMany({
          where: { status: "DELIVERED", deliveredAt: toDateFilter(range) },
          select: {
            id: true,
            jobNumber: true,
            customerName: true,
            deviceName: true,
            outcome: true,
            finalCharge: true,
            deliveredAt: true,
          },
          orderBy: { deliveredAt: "desc" },
          take: 10,
        }),
      ]);

    const revenue = delivered._sum.finalCharge ?? 0;
    const deliveredCount = delivered._count._all;
    const checked = fixed + notFixed;

    res.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        revenue,
        deliveredCount,
        averageCharge: deliveredCount ? revenue / deliveredCount : 0,
        receivedCount: received,
        fixedCount: fixed,
        notFixedCount: notFixed,
        fixRate: checked ? fixed / checked : null,
        waitingCount: waiting,
        readyCount: ready._count._all,
        readyValue: ready._sum.finalCharge ?? 0,
        topDevices: topDevices.map((row) => ({
          deviceName: row.deviceName,
          count: row._count._all,
        })),
        recentDelivered: recent.map((row) => ({
          ...row,
          deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

repairsRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await prisma.repairJob.findUnique({
      where: { id: req.params.id },
      select: repairSelect,
    });
    if (!row) {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    res.json({ data: mapRepair(row) });
  } catch (error) {
    next(error);
  }
});

/** Printable repair slip (opens in a new tab via ?token=, like bill PDFs). */
repairsRouter.get("/:id/slip", async (req, res, next) => {
  try {
    const row = await prisma.repairJob.findUnique({
      where: { id: req.params.id },
      select: repairSelect,
    });
    if (!row) {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    const pdf = await buildRepairSlipPdf(row);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download ? "attachment" : "inline"}; filename="${row.jobNumber}.pdf"`,
    );
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

repairsRouter.get("/:id/photo/:side", async (req, res, next) => {
  try {
    const side = req.params.side;
    if (side !== "front" && side !== "back") {
      res.status(400).json({ error: "Photo side must be front or back" });
      return;
    }
    const row = await prisma.repairJob.findUnique({
      where: { id: req.params.id },
      select: {
        frontPhoto: side === "front",
        frontPhotoType: side === "front",
        backPhoto: side === "back",
        backPhotoType: side === "back",
      },
    });
    const bytes = side === "front" ? row?.frontPhoto : row?.backPhoto;
    const type = side === "front" ? row?.frontPhotoType : row?.backPhotoType;
    if (!bytes || !type) {
      res.status(404).json({ error: "No photo" });
      return;
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
});

/**
 * Move a job along Received → Repaired → Delivered.
 * Repaired/Delivered need to know whether it was fixed; going back to
 * Received clears the completion details.
 */
repairsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }
    const existing = await prisma.repairJob.findUnique({
      where: { id: req.params.id },
      select: { outcome: true, repairedAt: true, finalCharge: true, repairNotes: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }

    const body = parsed.data;
    const now = new Date();
    let data;
    if (body.status === "RECEIVED") {
      data = {
        status: "RECEIVED",
        outcome: null,
        finalCharge: null,
        repairedAt: null,
        deliveredAt: null,
      };
    } else {
      const outcome = body.outcome ?? existing.outcome;
      if (!outcome) {
        res.status(400).json({ error: "Choose whether the phone was fixed" });
        return;
      }
      data = {
        status: body.status,
        outcome,
        finalCharge:
          body.finalCharge !== undefined ? body.finalCharge : existing.finalCharge,
        repairNotes: body.repairNotes ?? existing.repairNotes,
        repairedAt: existing.repairedAt ?? now,
        deliveredAt: body.status === "DELIVERED" ? now : null,
      };
    }

    const updated = await prisma.repairJob.update({
      where: { id: req.params.id },
      data,
      select: repairSelect,
    });
    res.json({ data: mapRepair(updated) });
  } catch (error) {
    next(error);
  }
});

repairsRouter.post(
  "/",
  (req, res, next) => {
    upload.fields([
      { name: "frontPhoto", maxCount: 1 },
      { name: "backPhoto", maxCount: 1 },
    ])(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "Photo is too large after compression. Try another photo.",
        });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const parsed = createRepairSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
        return;
      }

      const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const front = files.frontPhoto?.[0];
      const back = files.backPhoto?.[0];
      const data = parsed.data;

      const created = await prisma.$transaction(async (tx) => {
        const sequence = await tx.invoiceSequence.upsert({
          where: { id: REPAIR_SEQUENCE_ID },
          create: { id: REPAIR_SEQUENCE_ID, counter: 1 },
          update: { counter: { increment: 1 } },
        });
        return tx.repairJob.create({
          data: {
            jobNumber: `BMR-${String(sequence.counter).padStart(4, "0")}`,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerAddress: data.customerAddress,
            deviceName: data.deviceName,
            platform: data.platform,
            color: data.color,
            ram: data.ram,
            storage: data.storage,
            condition: data.condition ?? "",
            conditionNotes: data.conditionNotes,
            problemDescription: data.problemDescription,
            estimatedCost: data.estimatedCost,
            frontPhoto: front ? front.buffer : null,
            frontPhotoType: front ? front.mimetype : null,
            backPhoto: back ? back.buffer : null,
            backPhotoType: back ? back.mimetype : null,
            createdByUserId: req.user?.id || null,
            createdByName: req.user?.name || null,
          },
          select: repairSelect,
        });
      });

      res.status(201).json({ data: mapRepair(created) });
    } catch (error) {
      next(error);
    }
  },
);
