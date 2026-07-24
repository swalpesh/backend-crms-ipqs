import express from "express";
import { body } from "express-validator";
import { requireAuth, requireRole } from "../middleware/auth.js";

import { upload } from "../middleware/upload.js"; // Multer config

import { 
  createLead, 
  listLeads, 
  updateLeadStatus, 
  revertLeadToNew, 
  listLeadsByEmployee ,
  listTodaysFollowUps,
  listTeleMarketingEmployeesAndLeads,
  changeLeadStageByIpqsHead,
  assignLeadToEmployee,
  getAllLeadsForIpqsHead,
  getLeadById,
  updateLeadById,
  getLeadActivityById,
  addLeadNote,
  getLeadNotes,
  uploadNotesFiles,
  getAccessibleLeads,
  getFollowupHistoryByLead,
  updateQuotationCreatedStatus,
  getLeadOriginInfo,
  updatePoConfirmedStatus,
  getConfirmedRevenueAnalytics,
  deleteMultipleLeads,
  getFollowUpLeadsForAdmin,
  getLeadActivityByUser,finalizeLead, getFollowUpHistory
} from "../controllers/leads.controller.js";



const router = express.Router();

// Create Lead (Tele-Marketing Head & Employee both allowed)
// Create Lead
router.post(
  "/",
  requireAuth,
  // ⚠️ Check: Ensure these roles match your file context (e.g., Technical-Team vs Field-Marketing)
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee", "IpqsHead"]), 
  upload.array("attachments", 10),
  [
    // Existing validators
    body("lead_name").notEmpty().withMessage("Lead name is required"),
    body("lead_status").isIn(["new", "follow-up", "lost", "progress", "completed"]).withMessage("Invalid lead status"),

    // ✅ NEW VALIDATORS for the new fields
    body("lead_priority").optional().isIn(["High", "Medium", "Low"]).withMessage("Priority must be High, Medium, or Low"),
    body("expected_revenue").optional().isFloat({ min: 0 }).withMessage("Revenue must be a positive number"),
    body("probability").optional().isInt({ min: 0, max: 100 }).withMessage("Probability must be between 0 and 100"),
    body("mark_as_hot_lead").optional().isBoolean().withMessage("Hot Lead must be true or false"),
    // body("expected_closing_date").optional().isISO8601().toDate().withMessage("Invalid date format for closing date"),
    body("lead_type").optional().isString().withMessage("Lead Type must be a string"),
  ],
  createLead
);


router.get(
  "/",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  listLeads
);

router.get("/analytics/confirmed-revenue", requireAuth, getConfirmedRevenueAnalytics);


router.patch(
  "/:id/status",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  updateLeadStatus
);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  revertLeadToNew
);

router.get("/:lead_id/followups", getFollowUpHistory);

router.get(
  "/my-leads",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  listLeadsByEmployee
);

router.get(
  "/my-leads/today-followups",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  listTodaysFollowUps
);

router.get(
  "/telemarketing/all-leads",
  requireAuth,
  requireRole(["Tele-Marketing-Head","IpqsHead"]),
  listTeleMarketingEmployeesAndLeads
);

router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["ipqshead","Field-Marketing-Head","Associate-Marketing-Head","Corporate-Marketing-Head","Technical-Team-Head","Solutions-Team-Head","Field-Marketing-Employee","Associate-Marketing-Employee","Corporate-Marketing-Employee","Technical-Team-Employee","Solutions-Team-Employee","Quotation-Team-Head","Payments-Team-Head"]),
  changeLeadStageByIpqsHead
);

router.patch(
  "/assign",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "IpqsHead"]),
  assignLeadToEmployee
);

router.put("/quotation-created", requireAuth, updateQuotationCreatedStatus);
router.put("/po-status", requireAuth, updatePoConfirmedStatus);
router.patch("/finalize", requireAuth, finalizeLead);

router.get("/admin/follow-up", requireAuth, getFollowUpLeadsForAdmin);


router.get(
  "/all",
  requireAuth,
  requireRole(["IpqsHead"]),
  getAllLeadsForIpqsHead
);
router.get("/my-accessible-leads", requireAuth, getAccessibleLeads);
router.delete("/bulk-delete", requireAuth, deleteMultipleLeads);

router.get("/:lead_id", requireAuth, getLeadById);
router.put("/:lead_id", requireAuth, updateLeadById);
router.get("/:lead_id/activity", requireAuth, getLeadActivityById);
router.post("/:lead_id/notes", requireAuth, uploadNotesFiles.array("attachments", 5), addLeadNote);
router.get("/:lead_id/notes", requireAuth, getLeadNotes);
router.get("/:id/followup-history", getFollowupHistoryByLead);

router.get("/:lead_id/origin", requireAuth, getLeadOriginInfo);

router.get("/:lead_id/activity/:employee_id", getLeadActivityByUser);




export default router;
