import { Router } from "express";
import { z } from "zod";
import { runBillingReport } from "../services/dailyReports";

export const reportsRouter = Router();

const sendSchema = z.object({
  scope: z.enum(["today", "all"]).default("today"),
});

reportsRouter.post("/send", async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { report, mail } = await runBillingReport(parsed.data.scope);
    res.json({
      data: {
        scope: report.scope,
        filename: report.filename,
        billCount: report.billCount,
        dateLabel: report.dateLabel,
        emailedTo: mail.to,
        subject: mail.subject,
        messageId: mail.messageId,
      },
    });
  } catch (error) {
    next(error);
  }
});
