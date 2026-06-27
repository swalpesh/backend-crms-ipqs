import express from "express";
import { createAdminProfile, loginAdminProfile, getAllAdminProfiles } from "../controllers/adminProfiles.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Route to add a brand new sub-profile
router.post("/create", requireAuth, createAdminProfile);

// Route to authenticate into a selected sub-profile
router.post("/login", requireAuth, loginAdminProfile);

router.get("/list", requireAuth, getAllAdminProfiles);

// ✅ THIS IS THE LINE THAT WAS MISSING OR BROKEN
export default router;