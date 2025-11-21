// src/routes/contacts.routes.js
import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  createContact,
  listContacts,
  getContact,
  updateContact,
  deleteContact
} from "../controllers/contacts.controller.js";
import { requireAuth, requireEmployee } from "../middleware/auth.js";

const router = Router();

/**
 * Create contact (employees only)
 */
router.post(
  "/",
  requireAuth,
  requireEmployee,
  [
    body("first_name").trim().notEmpty(),
    body("last_name").trim().notEmpty(),
    body("designation").trim().notEmpty(),
    body("phone_number").optional().isString(),
    body("email").isEmail(),
    // Accept either company_id OR company_name
    body("company_id").optional().isString(),
    body("company_name").optional().isString(),
    body().custom(b => {
      if (!b.company_id && !b.company_name) {
        throw new Error("company_id or company_name is required");
      }
      return true;
    }),
    body("notes").optional().isString(),
    body("status").optional().isIn(["active","inactive"])
  ],
  createContact
);

/**
 * List contacts (any authenticated)
 * Filters: ?company_id= | ?company_name= | ?status=active|inactive | ?q=
 */
router.get(
  "/",
  requireAuth,
  [
    query("company_id").optional().isString(),
    query("company_name").optional().isString(),
    query("status").optional().isIn(["active","inactive"]),
    query("q").optional().isString()
  ],
  listContacts
);

/**
 * Get one (any authenticated)
 */
router.get(
  "/:id",
  requireAuth,
  [param("id").trim().notEmpty()], // "ipqs-con-001"
  getContact
);

/**
 * Update (employees only)
 */
router.patch(
  "/:id",
  requireAuth,
  requireEmployee,
  [
    param("id").trim().notEmpty(),
    body("email").optional().isEmail(),
    body("phone_number").optional().isString(),
    body("company_id").optional().isString(),
    body("company_name").optional().isString(),
    body("status").optional().isIn(["active","inactive"])
  ],
  updateContact
);

/**
 * Delete (employees only)
 */
router.delete(
  "/:id",
  requireAuth,
  requireEmployee,
  [param("id").trim().notEmpty()],
  deleteContact
);

export default router;
