import { Router } from "express";
import { requireAdmin } from "../../middleware/auth";
import { accCatalogRouter } from "./catalog";
import { accSalesRouter } from "./sales";
import { accCustomersRouter } from "./customers";
import { accSuppliersRouter } from "./suppliers";
import { accAnalyticsRouter } from "./analytics";
import { accBoxesRouter } from "./boxes";
import { accResetRouter } from "./reset";

/** Accessories shop API (/api/acc). Mounted behind requireAccessories. */
export const accRouter = Router();

accRouter.use(accCatalogRouter);
accRouter.use(accSalesRouter);
accRouter.use(accCustomersRouter);
accRouter.use(accSuppliersRouter);
accRouter.use(accBoxesRouter);
accRouter.use(accResetRouter);
accRouter.use("/analytics", requireAdmin);
accRouter.use(accAnalyticsRouter);
