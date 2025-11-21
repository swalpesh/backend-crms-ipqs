// src/routes/departments.routes.js
import { Router } from "express";
import { body, param } from "express-validator";
import {
  createDepartment,
  listDepartments,
  getDepartment,
  updateDepartment,
  deleteDepartment
} from "../controllers/departments.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Create (superadmin only)
router.post(
  "/",
  requireAuth,
  requireRole(["superadmin"]),
  [
    body("department_name")
      .trim()
      .notEmpty()
      .withMessage("department_name is required"),
    body("status")
      .optional()
      .isIn(["active", "inactive"])
      .withMessage("status must be active or inactive")
  ],
  createDepartment
);

// List (auth)
router.get("/", requireAuth, listDepartments);

// Get one (auth)
router.get(
  "/:id",
  requireAuth,
  [param("id").trim().notEmpty()],
  getDepartment
);

// Update (superadmin only)
router.patch(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  [
    param("id").trim().notEmpty(),
    body("department_name").optional().trim().notEmpty(),
    body("status").optional().isIn(["active", "inactive"])
  ],
  updateDepartment
);

// Delete (superadmin only)
router.delete(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  [param("id").trim().notEmpty()],
  deleteDepartment
);

export default router;
