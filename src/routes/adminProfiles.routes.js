import express from "express";
import { createAdminProfile, loginAdminProfile, getAllAdminProfiles } from "../controllers/adminProfiles.controller.js";
import {
  createLead
} from "../controllers/adminProfiles.controller.js";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { body } from "express-validator";

const router = express.Router();

// Create Lead
router.post(
  "/create-lead",
  requireAuth,
  // ⚠️ Check: Ensure these roles match your file context (e.g., Technical-Team vs Field-Marketing)
  requireRole(["Technical-Team-Head", "Technical-Team-Employee", "IpqsHead"]), 
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

// Route to add a brand new sub-profile
router.post("/create", requireAuth, createAdminProfile);

// Route to authenticate into a selected sub-profile
router.post("/login", requireAuth, loginAdminProfile);

router.get("/list", requireAuth, getAllAdminProfiles);

// ✅ THIS IS THE LINE THAT WAS MISSING OR BROKEN
export default router;