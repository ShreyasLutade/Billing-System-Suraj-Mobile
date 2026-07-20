import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type Role = "ADMIN" | "STAFF";

export type AuthUser = {
  id: string;
  phone: string;
  name: string;
  role: Role;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET =
  process.env.JWT_SECRET || "suraj-mobile-dev-secret-change-in-production";

export function signToken(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub || !payload.role || !payload.phone) return null;
    const role = payload.role as string;
    if (role !== "ADMIN" && role !== "STAFF") return null;
    return {
      id: String(payload.sub),
      phone: String(payload.phone),
      name: String(payload.name || ""),
      role,
    };
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === "string" && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Please log in to continue" });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: "Session expired. Please log in again" });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Please log in to continue" });
    return;
  }
  if (req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Analytics is available for admin only" });
    return;
  }
  next();
}
