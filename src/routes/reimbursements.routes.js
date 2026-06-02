import express from "express";
import multer from "multer"; // Make sure to npm install multer
import { requireAuth } from "../middleware/auth.js"; 
import { 
  createReimbursement, 
  updateReimbursement,
  getMyReimbursements,
  addReimbursementExpense,
  getReimbursementExpenses,
  getReimbursementSummary, 
  getAllReimbursementsForAdmin,
  getReimbursementDetails,
  processReimbursementExpenses,
  deleteReimbursement
} from "../controllers/reimbursements.controller.js";

const router = express.Router();

// --- Basic Multer Setup for uploading receipts ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure this folder (uploads/receipts/) exists in your root project directory!
    cb(null, "uploads/receipts/"); 
  },
  filename: function (req, file, cb) {
    // Adds a timestamp to prevent files with the same name from overwriting each other
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage: storage });
// -------------------------------------------------

// --- TRIP ROUTES ---
// GET: Fetch the logged-in employee's reimbursements
router.get("/", requireAuth, getMyReimbursements);

router.put("/process-expenses", requireAuth, processReimbursementExpenses);


// POST: Create a new reimbursement trip
router.post("/", requireAuth, createReimbursement);

// PUT: Update an existing reimbursement trip (e.g., adding an end date)
router.put("/:id", requireAuth, updateReimbursement);


// --- EXPENSE ROUTES ---
// GET: Fetch all expenses for a specific trip
router.get("/:id/expenses", requireAuth, getReimbursementExpenses);

// POST: Add a new expense (with file upload named 'billupload')
router.post("/expenses", requireAuth, upload.single("file"), addReimbursementExpense);

router.get("/summary", requireAuth, getReimbursementSummary);

router.get("/admin/all", requireAuth, getAllReimbursementsForAdmin);

router.get("/:id", requireAuth, getReimbursementDetails);

router.delete("/:id", requireAuth, deleteReimbursement);


export default router;