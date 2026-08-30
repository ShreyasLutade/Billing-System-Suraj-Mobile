import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { billsRouter } from "./routes/bills";
import { analyticsRouter } from "./routes/analytics";
import {
  financeCompaniesRouter,
  seedFinanceCompanies,
} from "./routes/financeCompanies";
import { duesRouter } from "./routes/dues";
import { authRouter, seedUsers } from "./routes/auth";
import { reportsRouter, reportsCronRouter } from "./routes/reports";
import { mobileCatalogRouter } from "./routes/mobileCatalog";
import { stockRouter } from "./routes/stock";
import { suppliersRouter } from "./routes/suppliers";
import { purchasesRouter } from "./routes/purchases";
import { phoneModelsRouter } from "./routes/phoneModels";
import { requireAuth, requireAdmin } from "./middleware/auth";
import { startDailyReportScheduler } from "./services/dailyReports";
import { prisma } from "./lib/prisma";
import { backfillSuppliersFromStock } from "./services/suppliers";
import { ensurePhoneModelsSeeded } from "./services/phoneModels";
import { ensurePasswordResetOtpTable } from "./services/passwordResetOtp";
import { backfillFinanceReceived2 } from "./services/backfillFinanceReceived2";

const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";
const clientDist = path.join(__dirname, "..", "public");
const serveClient = fs.existsSync(path.join(clientDist, "index.html"));

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isLocalViteOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1):(517\d|518\d)$/.test(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes("*") ||
        (isProduction && serveClient) ||
        (!isProduction && isLocalViteOrigin(origin))
      ) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "suraj-billing-api",
    time: new Date().toISOString(),
  });
});

// Railway Cron Jobs can hit this without a user JWT (uses REPORT_CRON_SECRET).
app.use("/api/reports/cron", reportsCronRouter);

app.use("/api/auth", authRouter);
app.use("/api/bills", requireAuth, billsRouter);
app.use("/api/analytics", requireAuth, requireAdmin, analyticsRouter);
app.use("/api/finance-companies", requireAuth, financeCompaniesRouter);
app.use("/api/mobile-catalog", requireAuth, mobileCatalogRouter);
app.use("/api/stock", requireAuth, stockRouter);
app.use("/api/suppliers", requireAuth, suppliersRouter);
app.use("/api/purchases", requireAuth, purchasesRouter);
app.use("/api/phone-models", requireAuth, phoneModelsRouter);
app.use("/api/dues", requireAuth, duesRouter);
app.use("/api/reports", requireAuth, requireAdmin, reportsRouter);

if (!serveClient) {
  app.get("/", (_req, res) => {
    res.json({
      service: "Suraj Billing API",
      message:
        "Open the website at http://localhost:5173 — this port is the API only.",
      health: "/api/health",
    });
  });
}

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Internal server error";
    const known =
      message === "FINANCE_COMPANY_NOT_FOUND"
        ? "Selected finance company was not found"
        : message.startsWith("Unknown argument") ||
            message.includes("Invalid `prisma")
          ? "Database is out of date. Restart the API after schema changes."
          : null;
    res.status(500).json({
      error: known || "Internal server error",
      ...(process.env.NODE_ENV !== "production" && !known
        ? { detail: message }
        : {}),
    });
  },
);

if (serveClient) {
  app.use(express.static(clientDist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

async function start() {
  await seedFinanceCompanies();
  await seedUsers();
  try {
    await ensurePasswordResetOtpTable();
  } catch (error) {
    console.warn("[auth] Password reset table skipped:", error);
  }
  try {
    await ensurePhoneModelsSeeded(prisma);
  } catch (error) {
    console.warn("[phone-models] Seed skipped:", error);
  }
  try {
    const result = await backfillSuppliersFromStock(prisma);
    if (result.linked || result.created) {
      console.log(
        `[suppliers] Backfill: linked ${result.linked} stock rows, created ${result.created} suppliers`,
      );
    }
  } catch (error) {
    console.warn("[suppliers] Backfill skipped:", error);
  }
  try {
    const count = await backfillFinanceReceived2(prisma);
    if (count > 0) {
      console.log(
        `[finance] Backfill: set financeReceived2 on ${count} dual-finance bill(s)`,
      );
    }
  } catch (error) {
    console.warn("[finance] Received2 backfill skipped:", error);
  }
  startDailyReportScheduler();
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Suraj Billing API running on http://localhost:${port}`);
    if (serveClient) {
      console.log("Serving web app from /public");
    }
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process and restart.`,
      );
      process.exit(1);
    }
    throw error;
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
