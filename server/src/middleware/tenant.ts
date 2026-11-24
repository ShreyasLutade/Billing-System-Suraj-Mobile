import type { NextFunction, Request, Response } from "express";
import { extractToken, verifyToken } from "./auth";
import { demoDatabaseUrl } from "../lib/prisma";
import { DEMO_PHONE, runWithTenant } from "../lib/tenant";
import { isDemoReady } from "../services/demoDatabase";

/** Things a demo must never reach (the real database file, owner emails). */
const BLOCKED_IN_DEMO = [
  /^\/api\/reports(\/|$)/,
  /^\/api\/auth\/forgot-password$/,
  /^\/api\/auth\/reset-password$/,
];

/**
 * Picks the database for this request: the demo login (token marked demo,
 * or signing in with the demo number) uses the demo database; everyone else
 * the real one.
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!demoDatabaseUrl()) {
    next();
    return;
  }
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  const phone =
    req.path.startsWith("/api/auth/") && typeof req.body?.phone === "string"
      ? req.body.phone.trim()
      : "";
  const demo = user ? user.demo === true : phone === DEMO_PHONE;
  if (!demo) {
    next();
    return;
  }
  if (BLOCKED_IN_DEMO.some((rule) => rule.test(req.path))) {
    res.status(403).json({ error: "Not available in the demo" });
    return;
  }
  // Demo staff / admins can't change or block accounts (keeps the demo login working).
  if (req.method === "PATCH" && /^\/api\/auth\/users\//.test(req.path)) {
    res.status(403).json({ error: "Not available in the demo" });
    return;
  }
  if (!isDemoReady()) {
    res.status(503).json({ error: "The demo is getting ready. Try again in a minute." });
    return;
  }
  runWithTenant(true, next);
}
