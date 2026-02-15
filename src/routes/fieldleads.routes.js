import express from "express";
import { body } from "express-validator";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

import {
  createLead,
  listLeads,
  updateLeadStatus,
  listLeadsByEmployee,
  listTodaysFollowUps,
  revertLeadToNew, 
  fieldMarketingAllLeads,
  changeLeadStageByIpqsHead,
  assignLeadToFieldEmployee,
  getFieldMarketingVisitDetails,
  getAllLeadsForIpqsHead,
  getScheduledFieldVisits,
  updateFieldVisitStatus,
  rescheduleFieldVisits,
  getUnscheduledFieldLeads,
  getCompletedLeadsByEmployee
} from "../controllers/fieldleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  // ⚠️ Check: Ensure these roles match your file context (e.g., Technical-Team vs Field-Marketing)
  requireRole(["Field-Marketing-Head", "Field-Marketing-Employee", "IpqsHead"]), 
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

// List Leads
router.get("/", requireAuth, listLeads);

// Update Lead Status
router.patch("/:id/status", requireAuth, updateLeadStatus);

// Get My Leads (Employee)
router.get("/my-leads", requireAuth, listLeadsByEmployee);

// Today's Follow-ups
router.get("/my-leads/today-followups", requireAuth, listTodaysFollowUps);

// Field Marketing All Leads (Head/IpqsHead)
router.get(
  "/fieldmarketing/all-leads",
  requireAuth,
  requireRole(["Field-Marketing-Head", "IpqsHead"]),
  fieldMarketingAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["IpqsHead", "Field-Marketing-Head", "Field-Marketing-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  requireRole(["Field-Marketing-Head", "Field-Marketing-Employee", "IpqsHead"]),
  assignLeadToFieldEmployee
);

//get field visit details
router.get(
  "/fieldmarketing/visit-details",
  requireAuth,
  requireRole(["Field-Marketing-Head"]),
  getFieldMarketingVisitDetails
);





// myactivity page api to get unscheduled leads assigned to particular employee -myactivity page
router.get(
  "/unscheduled-leads",
  requireAuth,
  getUnscheduledFieldLeads
);

// GET: Fetch scheduled field visits (supports ?date=YYYY-MM-DD query) -myactivity page
router.get(
  "/scheduled-visits",
  requireAuth,
  getScheduledFieldVisits
);

//start myactivity page api to update field visit status
router.patch(
  "/visit-status",
  requireAuth,
  updateFieldVisitStatus
);

router.patch(
  "/reschedule-visit",
  requireAuth,
  rescheduleFieldVisits
);

router.get(
  "/completed-visits",
  requireAuth,
  getCompletedLeadsByEmployee
);









// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Field-Marketing-Head", "Field-Marketing-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;
