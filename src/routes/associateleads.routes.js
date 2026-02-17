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
  AssociateMarketingAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  assignLeadToAssociateEmployee,
  getAssociateMarketingVisitDetails,
  getAllLeadsForIpqsHead,
  getHotAssociateLeads,
  getAssociateMarketingEmployeesRevenue,
  getNewAssignedLeadsSummary,
  getSalesFunnel,
  getUnscheduledAssociateLeads,
  getScheduledAssociateVisits,
  updateAssociateMarketingVisitStatus,
  rescheduleAssociateMarketingVisits,
  getCompletedAssociateVisits,
  AssociateTeamTodaysVisits
} from "../controllers/associateleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  // ⚠️ Check: Ensure these roles match your file context (e.g., Technical-Team vs Field-Marketing)
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee", "IpqsHead"]), 
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
  "/associatemarketing/all-leads",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "IpqsHead"]),
  AssociateMarketingAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["IpqsHead", "Associate-Marketing-Head", "Associate-Marketing-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee", "IpqsHead"]),
  assignLeadToAssociateEmployee
);
















// Dashboard API 

router.get(
  "/hot-leads",
  requireAuth,
  getHotAssociateLeads
);

router.get(
  "/employees-revenue",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee", "IpqsHead"]), 
  getAssociateMarketingEmployeesRevenue
);

router.get(
  "/new-assigned-summary",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee", "IpqsHead"]), 
  getNewAssignedLeadsSummary
);

router.get(
  "/sales-funnel",
  requireAuth,
  getSalesFunnel
);




//get associate marketing visit details
router.get(
  "/associatemarketing/visit-details",
  requireAuth,
  requireRole(["Associate-Marketing-Head"]),
  getAssociateMarketingVisitDetails
);


// myactivity page api to get unscheduled leads assigned to particular employee -myactivity page
router.get(
  "/unscheduled-leads",
  requireAuth,
  getUnscheduledAssociateLeads
);

// GET: Fetch scheduled associate marketing visits (supports ?date=YYYY-MM-DD query) -myactivity page
router.get(
  "/scheduled-visits",
  requireAuth,
  getScheduledAssociateVisits
);

//start myactivity page api to update associate marketing visit status
router.patch(
  "/visit-status",
  requireAuth,
  updateAssociateMarketingVisitStatus
);

router.patch(
  "/reschedule-visit",
  requireAuth,
  rescheduleAssociateMarketingVisits
);

router.get(
  "/completed-visits",
  requireAuth,
  getCompletedAssociateVisits
);

router.get(
  "/associatemarketing/todays-all-visits",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "IpqsHead"]),
  AssociateTeamTodaysVisits
);








// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;
