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
  assignLeadToEmployee,
  getAllLeadsForIpqsHead,
} from "../controllers/associateleads.controller.js";

const router = express.Router();

// Create Lead
router.post(
  "/",
  requireAuth,
  requireRole(["Associate-Marketing-Head", "Associate-Marketing-Employee", "IpqsHead"]),
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
  requireRole(["Associate-Marketing-Head", "IpqsHead"]),
  assignLeadToEmployee
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
