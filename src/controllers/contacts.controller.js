// src/controllers/contacts.controller.js
import { pool } from "../config/db.js";
import { validationResult } from "express-validator";
import { nextId } from "../utils/id.generator.js";

// Row → API
function mapContactRow(r) {
  return {
    contact_id: r.contact_id,
    first_name: r.first_name,
    last_name: r.last_name,
    designation: r.designation,
    phone_number: r.phone_number,
    email: r.email,
    company_id: r.company_id,
    company_name: r.company_name,
    notes: r.notes,
    status: r.status,
    created_by: r.created_by,
    created_at: r.created_at
  };
}

// Resolve company either by id or by exact company_name
async function resolveCompanyId(inputId, inputName) {
  if (inputId) {
    const [rows] = await pool.query(`SELECT company_id, company_name FROM companies WHERE company_id = ?`, [inputId.trim()]);
    if (rows.length) return rows[0];
    return null;
  }
  if (inputName) {
    const [rows] = await pool.query(`SELECT company_id, company_name FROM companies WHERE company_name = ?`, [inputName.trim()]);
    if (rows.length) return rows[0];
    return null;
  }
  return null;
}

/**
 * POST /api/v1/contacts
 * Employees only
 * Body (JSON):
 * {
 *   first_name, last_name, designation, phone_number?, email,
 *   company_id? OR company_name?,
 *   notes?, status? ('active'|'inactive')
 * }
 */
export const createContact = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    first_name,
    last_name,
    designation,
    phone_number,
    email,
    company_id,
    company_name,
    notes,
    status = "active"
  } = req.body;

  if (!["active", "inactive"].includes(String(status).trim()))
    return res.status(400).json({ message: "status must be 'active' or 'inactive'" });

  // Resolve company
  const company = await resolveCompanyId(company_id, company_name);
  if (!company) return res.status(400).json({ message: "Invalid company (by id or name)" });

  const creator = req.user.employee_id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Ensure email uniqueness per company (nice pre-check; the UNIQUE key will enforce too)
    const [[dupe]] = await conn.query(
      `SELECT COUNT(*) AS c FROM contacts WHERE company_id = ? AND email = ?`,
      [company.company_id, email.toLowerCase().trim()]
    );
    if (dupe.c) {
      await conn.query("ROLLBACK");
      return res.status(409).json({ message: "A contact with this email already exists for this company" });
    }

    // Generate id like ipqs-con-001
    const contact_id = await nextId(conn, "contact", "ipqs-con-", 3);

    await conn.query(
      `INSERT INTO contacts
       (contact_id, first_name, last_name, designation, phone_number, email, company_id, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contact_id,
        first_name.trim(),
        last_name.trim(),
        designation.trim(),
        phone_number ? phone_number.trim() : null,
        email.toLowerCase().trim(),
        company.company_id,
        notes ? notes.trim() : null,
        status.trim(),
        creator
      ]
    );

    await conn.commit();

    const [[row]] = await pool.query(
      `SELECT c.*, co.company_name
       FROM contacts c
       JOIN companies co ON co.company_id = c.company_id
       WHERE c.contact_id = ?`,
      [contact_id]
    );

    return res.status(201).json({ message: "Contact created", data: mapContactRow(row) });
  } catch (err) {
    await conn.query("ROLLBACK");
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A contact with this email already exists for this company" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to create contact" });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/v1/contacts
 * Auth: any (employee or superadmin)
 * Query: ?company_id=company001 | ?company_name=Initech | ?status=active|inactive | ?q=searchtext
 */
export const listContacts = async (req, res) => {
  try {
    const { company_id, company_name, status, q } = req.query;

    const where = [];
    const args = [];

    if (company_id) {
      where.push("c.company_id = ?");
      args.push(company_id.trim());
    } else if (company_name) {
      where.push("co.company_name = ?");
      args.push(company_name.trim());
    }
    if (status === "active" || status === "inactive") {
      where.push("c.status = ?");
      args.push(status);
    }
    if (q) {
      where.push("(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.designation LIKE ?)");
      const like = `%${q}%`;
      args.push(like, like, like, like);
    }

    let sql =
      `SELECT c.*, co.company_name
       FROM contacts c
       JOIN companies co ON co.company_id = c.company_id`;
    if (where.length) sql += ` WHERE ` + where.join(" AND ");
    sql += ` ORDER BY c.created_at DESC`;

    const [rows] = await pool.query(sql, args);
    return res.json({ data: rows.map(mapContactRow) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/v1/contacts/:id
 * Auth: any (employee or superadmin)
 */
export const getContact = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [rows] = await pool.query(
      `SELECT c.*, co.company_name
       FROM contacts c
       JOIN companies co ON co.company_id = c.company_id
       WHERE c.contact_id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json({ data: mapContactRow(rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PATCH /api/v1/contacts/:id
 * Employees only
 * - Allows changing company (by company_id or company_name)
 */
export const updateContact = async (req, res) => {
  const id = (req.params.id || "").trim();

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Ensure exists
    const [[exists]] = await conn.query(`SELECT contact_id, company_id, email FROM contacts WHERE contact_id = ?`, [id]);
    if (!exists) {
      await conn.query("ROLLBACK");
      return res.status(404).json({ message: "Not found" });
    }

    // Resolve (optional) new company
    let targetCompanyId = exists.company_id;
    if (b.company_id || b.company_name) {
      const company = await resolveCompanyId(b.company_id, b.company_name);
      if (!company) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid company (by id or name)" });
      }
      targetCompanyId = company.company_id;
    }

    // Build SETs
    const sets = [];
    const args = [];
    const set = (k, v) => { sets.push(`${k} = ?`); args.push(v); };

    if (b.first_name) set("first_name", b.first_name.trim());
    if (b.last_name) set("last_name", b.last_name.trim());
    if (b.designation) set("designation", b.designation.trim());
    if (typeof b.phone_number === "string") set("phone_number", b.phone_number.trim() || null);
    if (b.email) set("email", b.email.toLowerCase().trim());
    if (typeof b.notes === "string") set("notes", b.notes.trim() || null);
    if (typeof b.status === "string") {
      const st = b.status.trim();
      if (!["active","inactive"].includes(st)) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
      }
      set("status", st);
    }
    // company change?
    if (targetCompanyId !== exists.company_id) set("company_id", targetCompanyId);

    // Uniqueness check if email or company changed
    const emailToCheck = b.email ? b.email.toLowerCase().trim() : exists.email;
    const companyToCheck = targetCompanyId;
    if (emailToCheck && (b.email || targetCompanyId !== exists.company_id)) {
      const [[dupe]] = await conn.query(
        `SELECT COUNT(*) AS c FROM contacts WHERE company_id = ? AND email = ? AND contact_id <> ?`,
        [companyToCheck, emailToCheck, id]
      );
      if (dupe.c) {
        await conn.query("ROLLBACK");
        return res.status(409).json({ message: "A contact with this email already exists for this company" });
      }
    }

    if (sets.length) {
      args.push(id);
      await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE contact_id = ?`, args);
    }

    await conn.commit();

    const [[row]] = await pool.query(
      `SELECT c.*, co.company_name
       FROM contacts c
       JOIN companies co ON co.company_id = c.company_id
       WHERE c.contact_id = ?`,
      [id]
    );

    return res.json({ message: "Updated", data: mapContactRow(row) });
  } catch (err) {
    await conn.query("ROLLBACK");
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A contact with this email already exists for this company" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to update contact" });
  } finally {
    conn.release();
  }
};

/**
 * DELETE /api/v1/contacts/:id
 * Employees only
 */
export const deleteContact = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [result] = await pool.query(`DELETE FROM contacts WHERE contact_id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};
