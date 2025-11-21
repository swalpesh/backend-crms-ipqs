import { pool } from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import { getNextSuperAdminId } from "../utils/idGenerator.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

export const registerSuperAdmin = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { first_name, last_name, email, password, role, department, status } = req.body;

    const [exists] = await pool.query("SELECT id FROM super_admins WHERE email = ?", [email]);
    if (exists.length) return res.status(409).json({ message: "Email already registered" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const newId = await getNextSuperAdminId(conn);

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

      // ✅ Normalize role/department once here
      const normalizedRole = (role || "superadmin").toLowerCase().trim();
      const normalizedDept = (department || "core").toLowerCase().trim();

      await conn.query(
        `INSERT INTO super_admins (id, first_name, last_name, email, password_hash, role, department, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          first_name.trim(),
          last_name.trim(),
          email.toLowerCase().trim(),
          password_hash,
          normalizedRole,
          normalizedDept,
          (status || "active").trim()
        ]
      );

      await conn.commit();

      // ✅ Token uses normalized values
      const token = jwt.sign(
        {
          sub: newId,
          email: email.toLowerCase().trim(),
          role: normalizedRole,
          department: normalizedDept
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return res.status(201).json({
        message: "Super admin registered",
        data: {
          id: newId,
          first_name,
          last_name,
          email: email.toLowerCase().trim(),
          role: normalizedRole,
          department: normalizedDept,
          status: (status || "active").trim(),
          created_at: new Date().toISOString()
        },
        token
      });
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error(err);
      return res.status(500).json({ message: "Registration failed" });
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};


export const loginSuperAdmin = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const [rows] = await pool.query(
      `SELECT id, first_name, last_name, email, password_hash, role, department, status
       FROM super_admins WHERE email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });

    const admin = rows[0];

    if (admin.status !== "active") {
      return res.status(403).json({ message: "Account inactive" });
    }

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // ✅ Normalize from DB just in case DB has mixed case
    const normalizedRole = String(admin.role || "").toLowerCase().trim();
    const normalizedDept = String(admin.department || "").toLowerCase().trim();

    const token = jwt.sign(
      {
        sub: admin.id,
        email: admin.email.toLowerCase().trim(),
        role: normalizedRole,
        department: normalizedDept
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      message: "Login successful",
      data: {
        id: admin.id,
        first_name: admin.first_name,
        last_name: admin.last_name,
        email: admin.email.toLowerCase().trim(),
        role: normalizedRole,
        department: normalizedDept,
        status: admin.status
      },
      token
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};


// Example: a protected route that reads the token and returns payload
export const whoAmI = async (req, res) => {
  return res.json({
    sub: req.user.sub,
    email: req.user.email,
    role: req.user.role,
    department: req.user.department
  });
};
