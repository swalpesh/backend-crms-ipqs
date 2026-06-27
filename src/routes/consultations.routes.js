import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js"; 
import { 
  submitConsultationRequest, 
  getConsultationRequests 
} from "../controllers/consultations.controller.js";

const router = express.Router();

// --- Basic Multer Setup for uploading Electricity Bills ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure this folder exists in your project! (e.g., uploads/bills/)
    cb(null, "uploads/bills/"); 
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage: storage });
// ----------------------------------------------------------

// POST: Public route for the static website to submit data
// Uses upload.single("electricity_bill") to catch the optional file
router.post("/submit", upload.single("electricity_bill"), submitConsultationRequest);

// GET: Protected route for your CRM to view the submissions
router.get("/", requireAuth, getConsultationRequests);

export default router;