// src/routes/employees.routes.js
import { Router } from "express";
import { body, param } from "express-validator";
import multer from "multer";
import {
  createEmployee,
  listEmployees,
  getEmployee,
  getEmployeePhoto,
  updateEmployee,
  deleteEmployee
} from "../controllers/employees.controller.js";
import {
  loginEmployee,
  whoAmIEmployee
} from "../controllers/employeeAuth.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// Memory storage to keep file in RAM before writing to DB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

const router = Router();

/**
 * Employee Login (username OR email + password)
 * POST /api/v1/employees/login
 */
router.post(
  "/login",
  [
    body("password").notEmpty().withMessage("password is required"),
    body("username").optional().isString(),
    body("email").optional().isEmail()
  ],
  loginEmployee
);

/**
 * Employee Me (decode employee token)
 * GET /api/v1/employees/me
 */
router.get("/me", requireAuth, whoAmIEmployee);

/**
 * Create employee (superadmin only)
 * multipart/form-data with "photo" (file)
 */
router.post(
  "/",
  requireAuth,
  requireRole(["superadmin"]),
  upload.single("photo"),
  [
    body("employee_id").trim().notEmpty(),
    body("first_name").trim().notEmpty(),
    body("last_name").trim().notEmpty(),
    body("email").isEmail(),
    body("dob").isISO8601().withMessage("dob must be YYYY-MM-DD"),
    body("username").trim().notEmpty(),
    body("password").isLength({ min: 6 }),
    body("confirm_password").notEmpty(),
    body("department_id").trim().notEmpty(),
    body("role_id").trim().notEmpty(),
    body("location").optional().isString(),
    body("status").optional().isIn(["active","inactive"])  // ✅ status supported
  ],
  createEmployee
);

// List (auth)
router.get("/", requireAuth, listEmployees);

// Get one (auth)
router.get("/:id", requireAuth, [param("id").trim().notEmpty()], getEmployee);

// Get photo (auth)
router.get("/:id/photo", requireAuth, [param("id").trim().notEmpty()], getEmployeePhoto);

// Update (superadmin only) — multipart allowed (photo optional)
router.patch(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  upload.single("photo"),
  [
    param("id").trim().notEmpty(),
    body("status").optional().isIn(["active","inactive"])   // ✅ status supported
  ],
  updateEmployee
);

// Delete (superadmin only)
router.delete(
  "/:id",
  requireAuth,
  requireRole(["superadmin"]),
  [param("id").trim().notEmpty()],
  deleteEmployee
);

export default router;
