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
  TechnicalTeamAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  assignLeadToEmployee,
  getTechnicalTeamVisitDetails,
  getCompletedTechnicalVisits,
  startTechnicalVisit,
  storeVisitStartLocation,
  rescheduleTechnicalVisit,
  completeTechnicalVisit,
  addInternalMessage,
  getInternalMessages,
  TechnicalTeamTodaysVisits
  // getAllLeadsForIpqsHead,
} from "../controllers/technicalteamleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee", "IpqsHead"]),
  upload.array("attachments", 10),
  [
    body("lead_name").notEmpty().withMessage("Lead name is required"),
    body("lead_status").isIn(["new", "follow-up", "lost"]).withMessage("Invalid lead status"),
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

// Technical Marketing All Leads (Head/IpqsHead)
router.get(
  "/technicalteam/all-leads",
  requireAuth,
  requireRole(["Technical-Team-Head", "IpqsHead"]),
  TechnicalTeamAllLeads
);

router.get(
  "/technicalteam/todays-all-visits",
  requireAuth,
  requireRole(["Technical-Team-Head", "IpqsHead"]),
  TechnicalTeamTodaysVisits
);
//get visit details
router.get(
  "/technicalteam/visit-details",
  requireAuth,
  requireRole(["Technical-Team-Head"]),
  getTechnicalTeamVisitDetails
);

//get completed visits
router.get(
  "/technicalteam/completed-visits",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee"]),
  getCompletedTechnicalVisits
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["IpqsHead", "Technical-Team-Head", "Technical-Team-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  requireRole(["Technical-Team-Head", "IpqsHead"]),
  assignLeadToEmployee
);

// All Leads (IpqsHead)
// router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee","IpqsHead"]),
  revertLeadToNew
);

router.patch(
  "/:id/start-visit",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee"]),
  startTechnicalVisit
);

router.patch(
  "/:id/visit-location",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee"]),
  storeVisitStartLocation
);

router.patch(
  "/:id/reschedule",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee"]),
  rescheduleTechnicalVisit
);

router.patch(
  "/:id/complete-visit",
  requireAuth,
  requireRole(["Technical-Team-Head", "Technical-Team-Employee"]),
  completeTechnicalVisit
);

// Post a message (Supports file uploads)
router.post(
  "/discussion",
  requireAuth, 
  upload.array("attachments", 5), // Allows up to 5 files
  addInternalMessage
);

// Get discussion history for a specific lead
router.get(
  "/:lead_id/discussion",
  requireAuth, 
  getInternalMessages
);

export default router;
