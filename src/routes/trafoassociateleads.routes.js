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
  TrafoAssociatesAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  // 📝 CHANGED: Function name updated
  assignLeadToTrafoAssociateEmployee,
  // 📝 CHANGED: Function name updated
  getTrafoAssociatesVisitDetails,
  getAllLeadsForIpqsHead,
  // 📝 CHANGED: Function name updated
  getHotTrafoAssociateLeads,
  // 📝 CHANGED: Function name updated
  getTrafoAssociatesEmployeesRevenue,
  getNewAssignedLeadsSummary,
  getSalesFunnel,
  // 📝 CHANGED: Function name updated
  getUnscheduledTrafoAssociateLeads,
  // 📝 CHANGED: Function name updated
  getScheduledTrafoAssociateVisits,
  // 📝 CHANGED: Function name updated
  updateTrafoAssociateVisitStatus,
  // 📝 CHANGED: Function name updated
  rescheduleTrafoAssociateVisits,
  // 📝 CHANGED: Function name updated
  getCompletedTrafoAssociateVisits,
  // 📝 CHANGED: Function name updated
  TrafoAssociateTeamTodaysVisits
// 📝 CHANGED: Import path updated to the Trafo controller
} from "../controllers/trafoassociateleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"]), 
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
  "/trafoassociates/all-leads",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  TrafoAssociatesAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["IpqsHead", "Trafo-Associates-Head", "Trafo-Associates-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  assignLeadToTrafoAssociateEmployee
);

// Dashboard API 
router.get(
  "/hot-leads",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getHotTrafoAssociateLeads
);

router.get(
  "/employees-revenue",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"]), 
  // 📝 CHANGED: Function name updated
  getTrafoAssociatesEmployeesRevenue
);

router.get(
  "/new-assigned-summary",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"]), 
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
  "/trafoassociates/visit-details",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head"]),
  // 📝 CHANGED: Function name updated
  getTrafoAssociatesVisitDetails
);

// myactivity page api to get unscheduled leads assigned to particular employee
router.get(
  "/unscheduled-leads",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getUnscheduledTrafoAssociateLeads
);

// GET: Fetch scheduled visits (supports ?date=YYYY-MM-DD query)
router.get(
  "/scheduled-visits",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getScheduledTrafoAssociateVisits
);

//start myactivity page api to update visit status
router.patch(
  "/visit-status",
  requireAuth,
  // 📝 CHANGED: Function name updated
  updateTrafoAssociateVisitStatus
);

router.patch(
  "/reschedule-visit",
  requireAuth,
  // 📝 CHANGED: Function name updated
  rescheduleTrafoAssociateVisits
);

router.get(
  "/completed-visits",
  requireAuth,
  // 📝 CHANGED: Function name updated
  getCompletedTrafoAssociateVisits
);

router.get(
  // 📝 CHANGED: Route URL updated
  "/trafoassociates/todays-all-visits",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "IpqsHead"]),
  // 📝 CHANGED: Function name updated
  TrafoAssociateTeamTodaysVisits
);

// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  // 📝 CHANGED: Allowed roles updated
  requireRole(["Trafo-Associates-Head", "Trafo-Associates-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;