import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";

export type PasswordResetOtpRow = {
  id: string;
  phone: string;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
};

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: {
  id: string;
  phone: string;
  otpHash: string;
  expiresAt: Date | string;
  attempts: number | bigint;
  createdAt: Date | string;
}): PasswordResetOtpRow {
  return {
    id: row.id,
    phone: row.phone,
    otpHash: row.otpHash,
    expiresAt: asDate(row.expiresAt),
    attempts: Number(row.attempts),
    createdAt: asDate(row.createdAt),
  };
}

/** Works even if the Prisma client was generated before this model existed. */
export async function ensurePasswordResetOtpTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PasswordResetOtp" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "phone" TEXT NOT NULL,
      "otpHash" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PasswordResetOtp_phone_idx"
    ON "PasswordResetOtp"("phone")
  `);
}

export async function findLatestPasswordResetOtp(phone: string) {
  await ensurePasswordResetOtpTable();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      phone: string;
      otpHash: string;
      expiresAt: Date | string;
      attempts: number | bigint;
      createdAt: Date | string;
    }>
  >`
    SELECT "id", "phone", "otpHash", "expiresAt", "attempts", "createdAt"
    FROM "PasswordResetOtp"
    WHERE "phone" = ${phone}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function replacePasswordResetOtp(input: {
  phone: string;
  otpHash: string;
  expiresAt: Date;
}) {
  await ensurePasswordResetOtpTable();
  await prisma.$executeRaw`
    DELETE FROM "PasswordResetOtp" WHERE "phone" = ${input.phone}
  `;
  await prisma.$executeRaw`
    INSERT INTO "PasswordResetOtp"
      ("id", "phone", "otpHash", "expiresAt", "attempts", "createdAt")
    VALUES
      (${randomUUID()}, ${input.phone}, ${input.otpHash}, ${input.expiresAt}, 0, ${new Date()})
  `;
}

export async function deletePasswordResetOtps(phone: string) {
  await ensurePasswordResetOtpTable();
  await prisma.$executeRaw`
    DELETE FROM "PasswordResetOtp" WHERE "phone" = ${phone}
  `;
}

export async function incrementPasswordResetOtpAttempts(id: string) {
  await prisma.$executeRaw`
    UPDATE "PasswordResetOtp"
    SET "attempts" = "attempts" + 1
    WHERE "id" = ${id}
  `;
}
