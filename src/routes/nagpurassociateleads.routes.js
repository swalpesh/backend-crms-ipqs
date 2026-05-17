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
  // 📝 CHANGED: Function name updated
  NagpurAssociatesAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  // 📝 CHANGED: Function name updated
  assignLeadToNagpurAssociateEmployee,
  // 📝 CHANGED: Function name updated
  getNagpurAssociatesVisitDetails,
  getAllLeadsForIpqsHead,
  // 📝 CHANGED: Function name updated
  getHotNagpurAssociateLeads,
  // 📝 CHANGED: Function name updated
  getNagpurAssociatesEmployeesRevenue,
  getNewAssignedLeadsSummary,
  getSalesFunnel,
  // 📝 CHANGED: Function name updated
  getUnscheduledNagpurAssociateLeads,
  // 📝 CHANGED: Function name updated
  getScheduledNagpurAssociateVisits,
  // 📝 CHANGED: Function name updated
  updateNagpurAssociateVisitStatus,
  // 📝 CHANGED: Function name updated
  rescheduleNagpurAssociateVisits,
  // 📝 CHANGED: Function name updated
  getCompletedNagpurAssociateVisits,
  // 📝 CHANGED: Function name updated
  NagpurAssociateTeamTodaysVisits
// 📝 CHANGED: Import path updated to the Nagpur controller
} from "../controllers/nagpurassociateleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated for Nagpur Associates
  requireRole(["Nagpur-Associates-Head", "Nagpur-Associates-Employee", "IpqsHead"]), 
  upload.array("attachments", 10),
  [
    body("lead_name").notEmpty().withMessage("Lead name is required"),
    body("lead_status").isIn(["new", "follow-up", "lost", "progress", "completed"]).withMessage("Invalid lead status"),
    body("lead_priority").optional().isIn(["High", "Medium", "Low"]).withMessage("Priority must be High, Medium, or Low"),
    body("expected_revenue").optional().isFloat({ min: 0 }).withMessage("Revenue must be a positive number"),
    body("probability").optional().isInt({ min: 0, max: 100 }).withMessage("Probability must be between 0 and 100"),
    body("mark_as_hot_lead").optional().isBoolean().withMessage("Hot Lead must be true or false"),
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

// All Leads (Head/IpqsHead)
router.get(
  // 📝 CHANGED: Route URL updated
  "/nagpurassociates/all-leads",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  NagpurAssociatesAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["IpqsHead", "Nagpur-Associates-Head", "Nagpur-Associates-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "Nagpur-Associates-Employee", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  assignLeadToNagpurAssociateEmployee
);

// Dashboard API 
router.get(
  "/hot-leads",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getHotNagpurAssociateLeads
);

router.get(
  "/employees-revenue",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "Nagpur-Associates-Employee", "IpqsHead"]), 
  // 📝 CHANGED: Function name updated
  getNagpurAssociatesEmployeesRevenue
);

router.get(
  "/new-assigned-summary",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "Nagpur-Associates-Employee", "IpqsHead"]), 
  getNewAssignedLeadsSummary
);

router.get(
  "/sales-funnel",
  requireAuth,
  getSalesFunnel
);

//get visit details
router.get(
  // 📝 CHANGED: Route URL updated
  "/nagpurassociates/visit-details",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head"]),
  // 📝 CHANGED: Function name updated
  getNagpurAssociatesVisitDetails
);

// myactivity page api to get unscheduled leads assigned to particular employee
router.get(
  "/unscheduled-leads",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getUnscheduledNagpurAssociateLeads
);

// GET: Fetch scheduled visits (supports ?date=YYYY-MM-DD query)
router.get(
  "/scheduled-visits",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getScheduledNagpurAssociateVisits
);

//start myactivity page api to update visit status
router.patch(
  "/visit-status",
  requireAuth,
  // 📝 CHANGED: Function name updated
  updateNagpurAssociateVisitStatus
);

router.patch(
  "/reschedule-visit",
  requireAuth,
  // 📝 CHANGED: Function name updated
  rescheduleNagpurAssociateVisits
);

router.get(
  "/completed-visits",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getCompletedNagpurAssociateVisits
);

router.get(
  // 📝 CHANGED: Route URL updated
  "/nagpurassociates/todays-all-visits",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  NagpurAssociateTeamTodaysVisits
);

// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Nagpur-Associates-Head", "Nagpur-Associates-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;