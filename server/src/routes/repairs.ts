import { Router, type Request } from "express";
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
import { binRepairJob } from "../services/recycleBin";
import { buildRepairSlipPdf } from "../services/repairSlip";
import {
  REPAIR_SHOPS,
  homeRepairShop,
  isRepairShop,
  repairJobNumber,
  visibleRepairShops,
} from "../lib/repairShops";

export const repairsRouter = Router();


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
const STATUSES = ["RECEIVED", "IN_REPAIR", "REPAIRED", "DELIVERED"] as const;
const OUTCOMES = ["FIXED", "NOT_FIXED"] as const;
const PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;

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
  // Optional since the intake redesign (under More details).
  color: optionalText(40),
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
  imei: optionalText(40),
  /** yyyy-mm-dd from the form; not in the past. */
  expectedDeliveryAt: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const date = new Date(`${value}T18:00:00+05:30`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: "custom", message: "Choose a valid delivery date" });
        return z.NEVER;
      }
      return date;
    }),
  lockCode: optionalText(60),
  accessories: optionalText(200),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  outcome: z.enum(OUTCOMES).optional(),
  finalCharge: optionalAmount.optional(),
  repairNotes: optionalText(1000),
  /** Chips: work done (fixed) or reasons (not fixed), e.g. "Display replaced, Battery replaced". */
  workDone: optionalText(500),
  /** Needed when delivering a job with a charge. */
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  /** Shop's cost for the repair. Only saved for admins. */
  costPrice: optionalAmount.optional(),
  /** Someone other than the customer collecting the phone (both or neither). */
  pickupName: z.string().trim().min(2, "Enter the name of the person collecting").max(100).optional(),
  pickupPhone: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().length(10, "Enter a valid 10-digit mobile number"))
    .optional(),
});

/** List/detail fields — never the photo bytes. */
const repairSelect = {
  id: true,
  jobNumber: true,
  shop: true,
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
  costPrice: true,
  imei: true,
  expectedDeliveryAt: true,
  lockCode: true,
  accessories: true,
  finalCharge: true,
  status: true,
  outcome: true,
  repairNotes: true,
  workDone: true,
  paymentMethod: true,
  pickupName: true,
  pickupPhone: true,
  notifiedAt: true,
  startedAt: true,
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
  notifiedAt: Date | null;
  startedAt: Date | null;
  expectedDeliveryAt: Date | null;
} & Record<string, unknown>;

/**
 * API shape of a job. Cost price is the shop's own number: only admins get it,
 * plus a costPending flag (fixed, delivered, cost not entered yet).
 */
function mapRepair<T extends RepairRow>(row: T, isAdmin: boolean) {
  const {
    frontPhotoType,
    backPhotoType,
    createdAt,
    repairedAt,
    deliveredAt,
    notifiedAt,
    startedAt,
    expectedDeliveryAt,
    ...rest
  } = row;
  return {
    ...rest,
    condition: rest.condition ? rest.condition : null,
    hasFrontPhoto: Boolean(frontPhotoType),
    hasBackPhoto: Boolean(backPhotoType),
    createdAt: createdAt.toISOString(),
    repairedAt: repairedAt ? repairedAt.toISOString() : null,
    deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
    notifiedAt: notifiedAt ? notifiedAt.toISOString() : null,
    startedAt: startedAt ? startedAt.toISOString() : null,
    expectedDeliveryAt: expectedDeliveryAt ? expectedDeliveryAt.toISOString() : null,
    costPrice: isAdmin ? (rest.costPrice ?? null) : null,
    costPending:
      isAdmin &&
      rest.status === "DELIVERED" &&
      rest.outcome === "FIXED" &&
      (rest.costPrice === null || rest.costPrice === undefined),
  };
}

const isAdminReq = (req: Request) => req.user?.role === "ADMIN";

/**
 * Shops this request may see, narrowed by ?shop= when it's one of them.
 * Repair-only accounts see their shop; staff the main shop; admins all.
 */
function shopScope(req: Request) {
  const visible = visibleRepairShops(req.user!);
  const asked = req.query.shop;
  const shops = isRepairShop(asked) && visible.includes(asked) ? [asked] : visible;
  return { shop: { in: shops } };
}

/** Every /:id route: the job must belong to a shop this user can see (else 404). */
repairsRouter.param("id", async (req, res, next, id: string) => {
  try {
    const job = await prisma.repairJob.findUnique({ where: { id }, select: { shop: true } });
    if (!job || !isRepairShop(job.shop) || !visibleRepairShops(req.user!).includes(job.shop)) {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

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
        ...shopScope(req),
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
      // The tracker counts its tabs on the client, so send the recent 300.
      take: 300,
    });
    res.json({ data: rows.map((row) => mapRepair(row, isAdminReq(req))) });
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
    const scope = shopScope(req);

    const [delivered, received, fixed, notFixed, waiting, ready, topDevices, recent] =
      await Promise.all([
        prisma.repairJob.aggregate({
          where: { ...scope, status: "DELIVERED", deliveredAt: toDateFilter(range) },
          _count: { _all: true },
          _sum: { finalCharge: true },
        }),
        prisma.repairJob.count({ where: { ...scope, createdAt: toDateFilter(range) } }),
        prisma.repairJob.count({
          where: { ...scope, outcome: "FIXED", repairedAt: toDateFilter(range) },
        }),
        prisma.repairJob.count({
          where: { ...scope, outcome: "NOT_FIXED", repairedAt: toDateFilter(range) },
        }),
        prisma.repairJob.count({ where: { ...scope, status: { in: ["RECEIVED", "IN_REPAIR"] } } }),
        prisma.repairJob.aggregate({
          where: { ...scope, status: "REPAIRED" },
          _count: { _all: true },
          _sum: { finalCharge: true },
        }),
        prisma.repairJob.groupBy({
          by: ["deviceName"],
          where: { ...scope, createdAt: toDateFilter(range) },
          _count: { _all: true },
          orderBy: { _count: { deviceName: "desc" } },
          take: 5,
        }),
        prisma.repairJob.findMany({
          where: { ...scope, status: "DELIVERED", deliveredAt: toDateFilter(range) },
          select: {
            id: true,
            jobNumber: true,
            customerName: true,
            deviceName: true,
            outcome: true,
            finalCharge: true,
            costPrice: true,
            deliveredAt: true,
          },
          orderBy: { deliveredAt: "desc" },
          // Every delivery in the period: the analytics list has totals.
          take: 500,
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
    res.json({ data: mapRepair(row, isAdminReq(req)) });
  } catch (error) {
    next(error);
  }
});

/** Admins can delete a repair job; keep its complete snapshot in the recycle bin. */
repairsRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await binRepairJob(tx, req.params.id, req.user);
      await tx.repairJob.delete({ where: { id: req.params.id } });
    });
    res.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
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
 * Move a job along Received → In repair → Repaired → Delivered.
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
      select: {
        outcome: true,
        repairedAt: true,
        finalCharge: true,
        repairNotes: true,
        workDone: true,
        startedAt: true,
      },
    });
    if (!existing) {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }

    const body = parsed.data;
    const now = new Date();
    let data;
    if (body.status === "RECEIVED" || body.status === "IN_REPAIR") {
      // Not finished yet: clear any result. Back to Received also clears the start.
      data = {
        status: body.status,
        outcome: null,
        finalCharge: null,
        workDone: null,
        paymentMethod: null,
        pickupName: null,
        pickupPhone: null,
        startedAt: body.status === "IN_REPAIR" ? (existing.startedAt ?? now) : null,
        repairedAt: null,
        deliveredAt: null,
      };
    } else {
      const outcome = body.outcome ?? existing.outcome;
      if (!outcome) {
        res.status(400).json({ error: "Choose whether the phone was fixed" });
        return;
      }
      const finalCharge =
        body.finalCharge !== undefined ? body.finalCharge : existing.finalCharge;
      const delivering = body.status === "DELIVERED";
      // Money taken at the counter must say how it was paid.
      if (delivering && (finalCharge ?? 0) > 0 && !body.paymentMethod) {
        res.status(400).json({ error: "Choose how the customer paid" });
        return;
      }
      if (delivering && Boolean(body.pickupName) !== Boolean(body.pickupPhone)) {
        res.status(400).json({ error: "Enter both the name and number of the person collecting" });
        return;
      }
      data = {
        status: body.status,
        outcome,
        finalCharge,
        repairNotes: body.repairNotes ?? existing.repairNotes,
        workDone: body.workDone ?? existing.workDone,
        // Undoing a delivery (back to Repaired) clears the payment too.
        paymentMethod: delivering && (finalCharge ?? 0) > 0 ? body.paymentMethod : null,
        // Undoing a delivery also forgets who collected it.
        pickupName: delivering ? (body.pickupName ?? null) : null,
        pickupPhone: delivering ? (body.pickupPhone ?? null) : null,
        // Staff can't see or set the shop's cost.
        // Cost only applies to repaired phones: not fixed clears it.
        ...(outcome === "NOT_FIXED"
          ? { costPrice: null }
          : isAdminReq(req) && body.costPrice !== undefined
            ? { costPrice: body.costPrice }
            : {}),
        startedAt: existing.startedAt ?? now,
        repairedAt: existing.repairedAt ?? now,
        deliveredAt: delivering ? now : null,
      };
    }

    const updated = await prisma.repairJob.update({
      where: { id: req.params.id },
      data,
      select: repairSelect,
    });
    res.json({ data: mapRepair(updated, isAdminReq(req)) });
  } catch (error) {
    next(error);
  }
});

/** Fields the Edit screen can change (the intake details, not the progress). */
const editRepairSchema = createRepairSchema.pick({
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  deviceName: true,
  platform: true,
  imei: true,
  problemDescription: true,
  estimatedCost: true,
  expectedDeliveryAt: true,
  lockCode: true,
});

/** Edit a job's intake details (photos are replaced via /:id/photo/:side). */
repairsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = editRepairSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const updated = await prisma.repairJob.update({
      where: { id: req.params.id },
      data: parsed.data,
      select: repairSelect,
    });
    res.json({ data: mapRepair(updated, isAdminReq(req)) });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    next(error);
  }
});
/** Admin: set or change the shop's cost for a job, at any stage. */
repairsRouter.patch("/:id/cost", requireAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({ costPrice: optionalAmount }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid cost price", details: parsed.error.flatten() });
      return;
    }
    const updated = await prisma.repairJob.update({
      where: { id: req.params.id },
      data: { costPrice: parsed.data.costPrice },
      select: repairSelect,
    });
    res.json({ data: mapRepair(updated, true) });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    next(error);
  }
});

/** The shop called the customer about this job (shown in its activity). */
repairsRouter.post("/:id/notified", async (req, res, next) => {
  try {
    const updated = await prisma.repairJob.update({
      where: { id: req.params.id },
      data: { notifiedAt: new Date() },
      select: repairSelect,
    });
    res.json({ data: mapRepair(updated, isAdminReq(req)) });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      res.status(404).json({ error: "Repair job not found" });
      return;
    }
    next(error);
  }
});

/** Add or replace the front/back photo after intake (browser-compressed). */
repairsRouter.post(
  "/:id/photo/:side",
  (req, res, next) => {
    upload.single("photo")(req, res, (error: unknown) => {
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
      const side = req.params.side;
      if (side !== "front" && side !== "back") {
        res.status(404).json({ error: "Unknown photo side" });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Choose a JPEG, PNG or WebP photo" });
        return;
      }
      const updated = await prisma.repairJob.update({
        where: { id: req.params.id },
        data:
          side === "front"
            ? { frontPhoto: file.buffer, frontPhotoType: file.mimetype }
            : { backPhoto: file.buffer, backPhotoType: file.mimetype },
        select: repairSelect,
      });
      res.json({ data: mapRepair(updated, isAdminReq(req)) });
    } catch (error) {
      if ((error as { code?: string }).code === "P2025") {
        res.status(404).json({ error: "Repair job not found" });
        return;
      }
      next(error);
    }
  },
);
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
        // Each shop has its own number series.
        const shop = homeRepairShop(req.user!);
        const sequenceId = REPAIR_SHOPS[shop].sequenceId;
        const sequence = await tx.invoiceSequence.upsert({
          where: { id: sequenceId },
          create: { id: sequenceId, counter: 1 },
          update: { counter: { increment: 1 } },
        });
        return tx.repairJob.create({
          data: {
            jobNumber: repairJobNumber(shop, sequence.counter),
            shop,
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
            imei: data.imei,
            expectedDeliveryAt: data.expectedDeliveryAt,
            lockCode: data.lockCode,
            accessories: data.accessories,
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

      res.status(201).json({ data: mapRepair(created, isAdminReq(req)) });
    } catch (error) {
      next(error);
    }
  },
);
