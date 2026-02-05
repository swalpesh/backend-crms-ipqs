import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js"; // Your existing upload middleware
import { createReimbursement, getReimbursements, getReimbursementsByEmployeeId } from "../controllers/reimbursements.controller.js";


const router = express.Router();

// POST: Create New Reimbursement
router.post(
  "/create",
  requireAuth,         // Any logged-in employee can apply
  upload.single("file"), // Expecting a single file field named 'file'
  createReimbursement
);

//get reimbursements
router.get(
  "/", 
  requireAuth, // Accessible by everyone (Controller handles permissions)
  getReimbursements
);

router.get(
  "/employee/:employeeId", 
  requireAuth, 
  getReimbursementsByEmployeeId
);

export default router;