// src/routes/roles.routes.js
import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  createRole,
  listRoles,
  getRole,
  updateRole,
  deleteRole,
  listRolesByDepartment, 
  listRoless
} from "../controllers/roles.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Create (superadmin only)
router.post(
  "/",
  requireAuth,
  requireRole(["superadmin"]),
  [
    body("role_name").trim().notEmpty().withMessage("role_name is required"),
    body("department_id").trim().notEmpty().withMessage("department_id is required"),
    body("status").optional().isIn(["active", "inactive"])
  ],
  createRole
);

// List (auth)
router.get(
  "/",
  requireAuth,
  [
    query("status").optional().isIn(["active", "inactive"]),
    query("department_id").optional().isString()
  ],
  listRoles
);

// Get one (auth)
router.get(
  "/:id",
  requireAuth,
  [param("id").trim().notEmpty()],
  getRole
);

// Update (superadmin only)
router.patch(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  [
    param("id").trim().notEmpty(),
    body("role_name").optional().trim().notEmpty(),
    body("department_id").optional().trim().notEmpty(),
    body("status").optional().isIn(["active", "inactive"])
  ],
  updateRole
);

// Delete (superadmin only)
router.delete(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  [param("id").trim().notEmpty()],
  deleteRole
);

router.get(
  "/departments/:deptId/roles",
  requireAuth,
  requireRole(["superadmin"]),
  [ param("deptId").trim().notEmpty() ],
  listRolesByDepartment
);

/**
 * List roles with optional department_id filter
 * GET /api/v1/roles?department_id=department001
 * Auth: superadmin
 */
router.get(
  "/roles",
  requireAuth,
  requireRole(["superadmin"]),
  [ query("department_id").optional().isString() ],
  listRoless
);

export default router;
