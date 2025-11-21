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
  getFollowupHistoryByLead
} from "../controllers/leads.controller.js";



const router = express.Router();

// Create Lead (Tele-Marketing Head & Employee both allowed)
router.post(
  "/",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]), 
  upload.array("attachments", 10),   // allow up to 10 files
  [
    body("lead_name").notEmpty().withMessage("Lead name is required"),
    body("lead_status").isIn(["new", "follow-up", "lost"]).withMessage("Invalid lead status")
  ],
  createLead
);

router.get(
  "/",
  requireAuth,
  requireRole(["Tele-Marketing-Head", "Tele-Marketing-Employee","IpqsHead"]),
  listLeads
);




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

router.get(
  "/all",
  requireAuth,
  requireRole(["IpqsHead"]),
  getAllLeadsForIpqsHead
);
router.get("/my-accessible-leads", requireAuth, getAccessibleLeads);

router.get("/:lead_id", requireAuth, getLeadById);
router.put("/:lead_id", requireAuth, updateLeadById);
router.get("/:lead_id/activity", requireAuth, getLeadActivityById);
router.post("/:lead_id/notes", requireAuth, uploadNotesFiles.array("attachments", 5), addLeadNote);
router.get("/:lead_id/notes", requireAuth, getLeadNotes);
router.get("/:id/followup-history", getFollowupHistoryByLead);




export default router;
