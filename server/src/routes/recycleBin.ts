import { Router } from "express";
import { prisma } from "../lib/prisma";
import { BIN_DAYS, RestoreError, listBin, restoreEntry } from "../services/recycleBin";

/** Admin only (mounted behind requireAdmin): deleted items kept for BIN_DAYS. */
export const recycleBinRouter = Router();

recycleBinRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ data: await listBin(), meta: { days: BIN_DAYS } });
  } catch (error) {
    next(error);
  }
});

/** Undo a delete: puts everything back if nothing it depends on has changed. */
recycleBinRouter.post("/:id/restore", async (req, res, next) => {
  try {
    res.json({ data: await restoreEntry(req.params.id) });
  } catch (error) {
    if (error instanceof RestoreError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

/** Empty the bin: everything in it is gone for good. */
recycleBinRouter.delete("/", async (_req, res, next) => {
  try {
    const { count } = await prisma.recycleBinEntry.deleteMany({});
    res.json({ data: { removed: count } });
  } catch (error) {
    next(error);
  }
});
