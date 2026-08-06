import type { PrismaClient, Prisma } from "@prisma/client";
import { capacityDigits } from "../lib/capacity";
import { PHONE_MODEL_SEEDS } from "../data/phoneModels";

type Db = PrismaClient | Prisma.TransactionClient;

let seedPromise: Promise<void> | null = null;
let lastSeededCount = 0;

export async function ensurePhoneModelsSeeded(db: PrismaClient) {
  if (seedPromise && lastSeededCount >= PHONE_MODEL_SEEDS.length) {
    return seedPromise;
  }
  seedPromise = (async () => {
    if (!db.phoneModel) {
      throw new Error(
        "Prisma client is missing PhoneModel — run: npx prisma generate",
      );
    }

    // Migrate legacy "128 GB" / "1 TB" catalog rows to digits ("128" / "1024").
    const legacy = await db.phoneModel.findMany({
      where: {
        OR: [
          { storage: { contains: " " } },
          { storage: { contains: "GB" } },
          { storage: { contains: "TB" } },
          { ram: { contains: " " } },
          { ram: { contains: "GB" } },
        ],
      },
    });
    for (const row of legacy) {
      const storage = capacityDigits(row.storage);
      const ram =
        row.platform === "ANDROID" ? capacityDigits(row.ram || "") : "";
      if (!storage || (row.platform === "ANDROID" && !ram)) {
        await db.phoneModel.delete({ where: { id: row.id } });
        continue;
      }
      if (storage === row.storage && ram === (row.ram || "")) continue;
      await db.phoneModel.delete({ where: { id: row.id } });
      await db.phoneModel.upsert({
        where: {
          platform_name_storage_ram: {
            platform: row.platform,
            name: row.name,
            storage,
            ram,
          },
        },
        create: {
          platform: row.platform,
          name: row.name,
          storage,
          ram,
        },
        update: {},
      });
    }

    const chunkSize = 40;
    for (let i = 0; i < PHONE_MODEL_SEEDS.length; i += chunkSize) {
      const chunk = PHONE_MODEL_SEEDS.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((item) =>
          db.phoneModel.upsert({
            where: {
              platform_name_storage_ram: {
                platform: item.platform,
                name: item.name,
                storage: item.storage,
                ram: item.ram,
              },
            },
            create: item,
            update: {},
          }),
        ),
      );
    }
    lastSeededCount = PHONE_MODEL_SEEDS.length;
  })().catch((error) => {
    seedPromise = null;
    lastSeededCount = 0;
    throw error;
  });
  return seedPromise;
}

export async function upsertPhoneModel(
  db: Db,
  input: {
    platform: "IOS" | "ANDROID";
    name: string;
    storage: string;
    ram?: string | null;
  },
) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const storage = capacityDigits(input.storage);
  const ram =
    input.platform === "ANDROID" ? capacityDigits(input.ram || "") : "";
  if (!name || !storage) return null;
  if (input.platform === "ANDROID" && !ram) return null;

  return db.phoneModel.upsert({
    where: {
      platform_name_storage_ram: {
        platform: input.platform,
        name,
        storage,
        ram,
      },
    },
    create: { platform: input.platform, name, storage, ram },
    update: {},
  });
}
