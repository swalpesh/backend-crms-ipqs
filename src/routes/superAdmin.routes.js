import { Router } from "express";
import { body } from "express-validator";
import {
  registerSuperAdmin,
  loginSuperAdmin,
  whoAmI
} from "../controllers/superAdmin.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * POST /api/v1/superadmin/register
 * Body: first_name, last_name, email, password, role?, department?, status?
 */
router.post(
  "/register",
  [
    body("first_name").trim().notEmpty().withMessage("first_name is required"),
    body("last_name").trim().notEmpty().withMessage("last_name is required"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
    body("role").optional().isString(),
    body("department").optional().isString(),
    body("status").optional().isIn(["active", "inactive"])
  ],
  registerSuperAdmin
);

/**
 * POST /api/v1/superadmin/login
 * Body: email, password
 */
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required")
  ],
  loginSuperAdmin
);

/**
 * GET /api/v1/superadmin/me
 * Header: Authorization: Bearer <token>
 */
router.get("/me", requireAuth, whoAmI);

export default router;
