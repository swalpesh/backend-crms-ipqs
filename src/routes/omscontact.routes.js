import express from "express";
import { submitContactForm } from "../controllers/contactController.js";

const router = express.Router();

// 🌍 PUBLIC CONTACT FORM
router.post("/", submitContactForm);

export default router;
