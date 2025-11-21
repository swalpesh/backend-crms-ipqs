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
  SolutionsTeamAllLeads,
  revertLeadToNew, 
  changeLeadStageByIpqsHead,
  assignLeadToEmployee,
  getAllLeadsForIpqsHead,
} from "../controllers/solutionsteam.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  requireRole(["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"]),
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

// Field Marketing All Leads (Head/IpqsHead)
router.get(
  "/solutionsteam/all-leads",
  requireAuth,
  requireRole(["Solutions-Team-Head", "IpqsHead"]),
  SolutionsTeamAllLeads
);

// Change Lead Stage
router.patch(
  "/change-stage",
  requireAuth,
  requireRole(["IpqsHead", "Solutions-Team-Head", "Solutions-Team-Employee"]),
  changeLeadStageByIpqsHead
);

// Assign Lead
router.patch(
  "/assign",
  requireAuth,
  requireRole(["Solutions-Team-Head", "IpqsHead"]),
  assignLeadToEmployee
);

// All Leads (IpqsHead)
router.get("/all", requireAuth, requireRole(["IpqsHead"]), getAllLeadsForIpqsHead);

router.patch(
  "/:id/revert",
  requireAuth,
  requireRole(["Solutions-Team-Head", "Solutions-Team-Employee","IpqsHead"]),
  revertLeadToNew
);

export default router;
