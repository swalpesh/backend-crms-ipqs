// src/controllers/employeeAuth.controller.js
import { pool } from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

/**
 * POST /api/v1/employees/login
 * Body: { username?: string, email?: string, password: string }
 * - Accepts either username or email
 * - Only active employees can login
 * - Returns JWT with employee + dept/role claims
 */
export const loginEmployee = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password } = req.body;

    // Build WHERE by identifier
    let where = "";
    let arg;
    if (username) {
      where = "e.username = ?";
      arg = username.trim();
    } else if (email) {
      where = "e.email = ?";
      arg = email.toLowerCase().trim();
    } else {
      return res.status(400).json({ message: "username or email is required" });
    }

    // Pull employee with joins for dept/role
    const [rows] = await pool.query(
      `
      SELECT e.employee_id, e.username, e.email, e.password_hash, e.status,
             e.department_id, e.role_id,
             d.department_name,
             r.role_name
      FROM employees e
      JOIN departments d ON d.department_id = e.department_id
      JOIN roles r       ON r.role_id       = e.role_id
      WHERE ${where}
      LIMIT 1
      `,
      [arg]
    );

    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });

    const emp = rows[0];

    // Must be active
    if (emp.status !== "active") {
      return res.status(403).json({ message: "Account inactive" });
    }

    // Check password
    const ok = await bcrypt.compare(password, emp.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // Build token payload
    const payload = {
      sub: emp.employee_id,
      employee_id: emp.employee_id,
      username: emp.username,
      email: emp.email.toLowerCase(),
      department_id: emp.department_id,
      department_name: emp.department_name,
      role_id: emp.role_id,
      role_name: emp.role_name
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // Response (no sensitive hashes)
    return res.json({
      message: "Login successful",
      data: {
        employee_id: emp.employee_id,
        username: emp.username,
        email: emp.email.toLowerCase(),
        department_id: emp.department_id,
        department_name: emp.department_name,
        role_id: emp.role_id,
        role_name: emp.role_name,
        status: emp.status
      },
      token
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/v1/employees/me
 * - Returns the decoded JWT claims for the logged-in employee
 */
export const whoAmIEmployee = async (req, res) => {
  // req.user is set by requireAuth
  const u = req.user || {};
  return res.json({
    sub: u.sub,
    employee_id: u.employee_id,
    username: u.username,
    email: u.email,
    department_id: u.department_id,
    department_name: u.department_name,
    role_id: u.role_id,
    role_name: u.role_name
  });
};
