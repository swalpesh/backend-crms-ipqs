// src/routes/quotations.routes.js
import express from "express";
import {
  createQuotation,
  listQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  patchQuotationStatus,
  uploadCover,           // <-- multer middleware
  listMyQuotations,
  getApprovedQuotations,
  getQuotationTeamLeads,
  getPaymentsTeamLeadsWithQuotations
} from "../controllers/quotations.controller.js";
import { requireAuth, requireEmployee } from "../middleware/auth.js";

const router = express.Router();

router.post("/", requireAuth, uploadCover.single("cover_photo"), createQuotation);
router.get("/my", requireAuth, listMyQuotations);
router.get("/", requireAuth, listQuotations);
router.get("/approved", requireAuth, getApprovedQuotations);
router.get("/quotation-team", requireAuth, getQuotationTeamLeads);
router.get(
  "/payments-team/leads",
  requireAuth,
  getPaymentsTeamLeadsWithQuotations
);
router.get("/:id", requireAuth, getQuotation);
router.put("/:id", requireAuth, uploadCover.single("cover_photo"), updateQuotation);
router.delete("/:id", requireAuth, deleteQuotation);
router.patch("/:id/status", requireAuth, patchQuotationStatus);


export default router;
