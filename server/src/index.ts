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
import { reportsRouter } from "./routes/reports";
import { mobileCatalogRouter } from "./routes/mobileCatalog";
import { requireAuth, requireAdmin } from "./middleware/auth";
import { startDailyReportScheduler } from "./services/dailyReports";

const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";
const clientDist = path.join(__dirname, "..", "public");
const serveClient = fs.existsSync(path.join(clientDist, "index.html"));

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes("*") ||
        (isProduction && serveClient)
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

app.use("/api/auth", authRouter);
app.use("/api/bills", requireAuth, billsRouter);
app.use("/api/analytics", requireAuth, requireAdmin, analyticsRouter);
app.use("/api/finance-companies", requireAuth, financeCompaniesRouter);
app.use("/api/mobile-catalog", requireAuth, mobileCatalogRouter);
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
