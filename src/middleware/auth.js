// src/middleware/auth.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verifies JWT from Authorization header: "Bearer <token>"
 * Attaches decoded payload to req.user (sub, email, role, department)
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { sub, email, role, department }
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * Restricts access to users whose role is in the provided list.
 * Usage: router.post("/...", requireAuth, requireRole(["superadmin"]), handler)
 * You can also pass a single string: requireRole("superadmin")
 */
export function requireRole(roles = []) {
  const allowed = (Array.isArray(roles) ? roles : [roles]).map(r => String(r).toLowerCase());
  return (req, res, next) => {
    const role = String(req.user?.role_id || req.user?.role || "").toLowerCase();
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}






// Employee-only guard: require a token that has employee_id (i.e., employee login)
export function requireEmployee(req, res, next) {
  // Employee tokens we created include employee_id
  if (req.user?.employee_id) return next();
  return res.status(403).json({ message: "Employees only" });
}
