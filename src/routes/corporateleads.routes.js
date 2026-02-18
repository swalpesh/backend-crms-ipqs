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
  CorporateMarketingAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  assignLeadToCorporateEmployee,
  getCorporateMarketingVisitDetails,
  getAllLeadsForIpqsHead,
  getUnscheduledCorporateLeads,
  getScheduledCorporateVisits,
  updateCorporateMarketingVisitStatus,
  rescheduleCorporateMarketingVisits,
  getCompletedCorporateVisits,
  CorporateTeamTodaysVisits,
  getHotCorporateLeads,
  getCorporateMarketingEmployeesRevenue,
  getNewAssignedLeadsSummary,
  getSalesFunnel

} from "../controllers/corporateleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  // ⚠️ Check: Ensure these roles match your file context (e.g., Technical-Team vs Field-Marketing)
  requireRole(["Corporate-Marketing-Head", "Corporate-Marketing-Employee", "IpqsHead"]), 
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
  "/corporatemarketing/all-leads",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "IpqsHead"]),
  CorporateMarketingAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["IpqsHead", "Corporate-Marketing-Head", "Corporate-Marketing-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "Corporate-Marketing-Employee", "IpqsHead"]),
  assignLeadToCorporateEmployee
);

//get corporate marketing visit details
router.get(
  "/corporatemarketing/visit-details",
  requireAuth,
  requireRole(["Corporate-Marketing-Head"]),
  getCorporateMarketingVisitDetails
);





// myactivity page api to get unscheduled leads assigned to particular employee -myactivity page
router.get(
  "/unscheduled-leads",
  requireAuth,
  getUnscheduledCorporateLeads
);

// GET: Fetch scheduled corporate marketing visits (supports ?date=YYYY-MM-DD query) -myactivity page
router.get(
  "/scheduled-visits",
  requireAuth,
  getScheduledCorporateVisits
);

//start myactivity page api to update corporate marketing visit status
router.patch(
  "/visit-status",
  requireAuth,
  updateCorporateMarketingVisitStatus
);

router.patch(
  "/reschedule-visit",
  requireAuth,
  rescheduleCorporateMarketingVisits
);

router.get(
  "/completed-visits",
  requireAuth,
  getCompletedCorporateVisits
);

router.get(
  "/corporatemarketing/todays-all-visits",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "IpqsHead"]),
  CorporateTeamTodaysVisits
);








// Dashboard API 

router.get(
  "/hot-leads",
  requireAuth,
  getHotCorporateLeads
);

router.get(
  "/employees-revenue",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "Corporate-Marketing-Employee", "IpqsHead"]), 
  getCorporateMarketingEmployeesRevenue
);

router.get(
  "/new-assigned-summary",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "Corporate-Marketing-Employee", "IpqsHead"]), 
  getNewAssignedLeadsSummary
);

router.get(
  "/sales-funnel",
  requireAuth,
  getSalesFunnel
);



// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Corporate-Marketing-Head", "Corporate-Marketing-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;
