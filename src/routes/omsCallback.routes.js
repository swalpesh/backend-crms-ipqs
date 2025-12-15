import express from "express";
import { submitITCallbackRequest } from "../controllers/omsCallbackController.js";

const router = express.Router();

/* PUBLIC API */
router.post("/", submitITCallbackRequest);

export default router;
