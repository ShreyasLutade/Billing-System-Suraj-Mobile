import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAdmin } from "../../middleware/auth";

/**
 * "Start fresh" for the accessories shop (admin only, password + CLEAR).
 * Deletes products, stock, cover splits and box contents, purchases,
 * suppliers and their payments, counter/wholesale bills, customers and
 * their payments, and restarts bill numbers. Keeps customer groups,
 * supplier groups, categories, the empty cover boxes and settings.
 */
export const accResetRouter = Router();

accResetRouter.post("/reset", requireAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({ password: z.string().min(1), confirm: z.literal("CLEAR") }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Type CLEAR and enter your password" });
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
    if (!me || !(await bcrypt.compare(parsed.data.password, me.passwordHash))) {
      return void res.status(403).json({ error: "Wrong password" });
    }
    const counts = await prisma.$transaction(async (tx) => {
      const c = {
        boxItems: (await tx.accBoxItem.deleteMany()).count,
        saleItems: (await tx.accSaleItem.deleteMany()).count,
        payments: (await tx.accPayment.deleteMany()).count,
        sales: (await tx.accSale.deleteMany()).count,
        purchaseItems: (await tx.accPurchaseItem.deleteMany()).count,
        supplierPayments: (await tx.accSupplierPayment.deleteMany()).count,
        purchases: (await tx.accPurchase.deleteMany()).count,
        suppliers: (await tx.accSupplier.deleteMany()).count,
        customers: (await tx.accCustomer.deleteMany()).count,
        stockMoves: (await tx.accStockMove.deleteMany()).count,
        models: (await tx.accProductModel.deleteMany()).count,
        products: (await tx.accProduct.deleteMany()).count,
      };
      await tx.accCounter.deleteMany({ where: { key: { in: ["RETAIL", "WHOLESALE", "OPENING"] } } });
      return c;
    });
    console.log(`[acc] start fresh by ${req.user?.name ?? "admin"}:`, counts);
    res.json({ data: counts });
  } catch (error) {
    next(error);
  }
});
