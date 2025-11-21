// src/routes/payments.routes.js
import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  createPayment,
  listPayments,
  getPayment,
  generateInvoice, // ✅ NEW,
  getAllPaymentDetails
} from "../controllers/payments.controller.js";
import { requireAuth, requireEmployee } from "../middleware/auth.js";

const router = Router();

/**
 * Create a payment entry
 */
router.post(
  "/",
  requireAuth,
  requireEmployee,
  [
    body("quotation_id").optional().isString(),
    body("quotation_no").optional().isString(),
    body().custom(b => {
      if (!b.quotation_id && !b.quotation_no) throw new Error("quotation_id or quotation_no is required");
      return true;
    }),
    body("payment_type").isString().notEmpty(),
    body("payment_date").isISO8601().withMessage("payment_date must be YYYY-MM-DD"),
    body("payment_time").matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage("payment_time must be HH:MM or HH:MM:SS"),
    body("amount").optional().isFloat({ min: 0.01 }),
    body("remarks").optional().isString()
  ],
  createPayment
);

router.get("/details", requireAuth, getAllPaymentDetails);

/**
 * List payments; supports filters
 */
router.get(
  "/",
  requireAuth,
  [
    query("quotation_id").optional().isString(),
    query("quotation_no").optional().isString()
  ],
  listPayments
);

/**
 * Get a single payment by id
 */
router.get(
  "/:id",
  requireAuth,
  [param("id").trim().notEmpty()],
  getPayment
);

/**
 * Generate invoice for a payment (marks invoice_status='generated')
 * No body required.
 */
router.post(
  "/:id/generate-invoice",
  requireAuth,
  requireEmployee,
  [param("id").trim().notEmpty()],
  generateInvoice
);

export default router;
