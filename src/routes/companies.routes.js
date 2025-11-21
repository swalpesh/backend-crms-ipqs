// src/routes/companies.routes.js
import { Router } from "express";
import { body, param, query } from "express-validator";
import multer from "multer";
import {
  createCompany,
  listCompanies,
  getCompany,
  downloadCompanyDoc,
  updateCompany,
  deleteCompany
} from "../controllers/companies.controller.js";
import { requireAuth, requireEmployee } from "../middleware/auth.js";

const router = Router();

// Multiple documents; 10 files, up to 10MB each (adjust as needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});

// Create (employees only)
router.post(
  "/",
  requireAuth,
  requireEmployee,
  upload.array("documents", 10),
  [
    body("company_name").trim().notEmpty(),
    body("company_email").isEmail(),
    body("company_contact").trim().notEmpty(),
    body("company_website").optional().isURL().withMessage("Provide a valid URL"),
    body("industry").trim().notEmpty(),
    body("address").trim().notEmpty(),
    body("contact_person_name").trim().notEmpty(),
    body("notes").optional().isString(),
    body("status").optional().isIn(["active","inactive"])
  ],
  createCompany
);

// List (any authenticated)
router.get(
  "/",
  requireAuth,
  [query("status").optional().isIn(["active","inactive"])],
  listCompanies
);

// Get one (any authenticated)
router.get(
  "/:id",
  requireAuth,
  [param("id").trim().notEmpty()], // string like company001
  getCompany
);

// Download a document (any authenticated)
router.get(
  "/:id/documents/:doc_id",
  requireAuth,
  [param("id").trim().notEmpty(), param("doc_id").trim().notEmpty()], // doc001
  downloadCompanyDoc
);

// Update (employees only)
router.patch(
  "/:id",
  requireAuth,
  requireEmployee,
  upload.array("documents", 10),
  [
    param("id").trim().notEmpty(),
    body("company_email").optional().isEmail(),
    body("company_website").optional().isURL(),
    body("status").optional().isIn(["active","inactive"]),
    body("remove_doc_ids").optional().isString()
  ],
  updateCompany
);

// Delete (employees only)
router.delete(
  "/:id",
  requireAuth,
  requireEmployee,
  [param("id").trim().notEmpty()],
  deleteCompany
);

export default router;
