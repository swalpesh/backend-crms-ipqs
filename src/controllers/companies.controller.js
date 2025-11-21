// src/controllers/companies.controller.js
import { pool } from "../config/db.js";
import { validationResult } from "express-validator";
import { nextId } from "../utils/id.generator.js";

function mapCompanyRow(r) {
  return {
    company_id: r.company_id,
    company_name: r.company_name,
    company_email: r.company_email,
    company_contact: r.company_contact,
    company_website: r.company_website,
    industry: r.industry,
    address: r.address,
    contact_person_name: r.contact_person_name,
    notes: r.notes,
    status: r.status,
    created_by: r.created_by,
    created_at: r.created_at
  };
}

function mapDocMeta(d) {
  return {
    doc_id: d.doc_id,
    filename: d.filename,
    mime: d.mime,
    size_bytes: d.size_bytes,
    uploaded_by: d.uploaded_by,
    created_at: d.created_at
  };
}

/**
 * POST /api/v1/companies
 * multipart/form-data
 *  - text fields
 *  - documents[] (optional files)
 * Employees only
 */
export const createCompany = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    company_name,
    company_email,
    company_contact,
    company_website,
    industry,
    address,
    contact_person_name,
    notes,
    status = "active"
  } = req.body;

  if (!["active", "inactive"].includes(status?.trim()))
    return res.status(400).json({ message: "status must be 'active' or 'inactive'" });

  const docs = Array.isArray(req.files) ? req.files : [];
  const uploader = req.user.employee_id; // set by requireEmployee

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Generate company id like "company001"
    const company_id = await nextId(conn, "company", "company", 3);

    await conn.query(
      `INSERT INTO companies
       (company_id, company_name, company_email, company_contact, company_website, industry, address,
        contact_person_name, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id,
        company_name.trim(),
        company_email.toLowerCase().trim(),
        company_contact.trim(),
        company_website ? company_website.trim() : null,
        industry.trim(),
        address.trim(),
        contact_person_name.trim(),
        notes ? notes.trim() : null,
        status.trim(),
        uploader
      ]
    );

    // Insert optional documents with ids like "doc001"
    for (const f of docs) {
      const doc_id = await nextId(conn, "doc", "doc", 3);
      await conn.query(
        `INSERT INTO company_documents
         (doc_id, company_id, filename, mime, size_bytes, data, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [doc_id, company_id, f.originalname, f.mimetype || null, f.size || null, f.buffer || null, uploader]
      );
    }

    await conn.commit();

    const [[row]] = await pool.query(`SELECT * FROM companies WHERE company_id = ?`, [company_id]);
    const [docRows] = await pool.query(
      `SELECT doc_id, filename, mime, size_bytes, uploaded_by, created_at
       FROM company_documents WHERE company_id = ? ORDER BY created_at DESC`,
      [company_id]
    );

    return res.status(201).json({
      message: "Company created",
      data: { ...mapCompanyRow(row), documents: docRows.map(mapDocMeta) }
    });
  } catch (err) {
    await conn.query("ROLLBACK");
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Company email already exists" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to create company" });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/v1/companies
 * ?status=active|inactive
 * Any authenticated user
 */
export const listCompanies = async (req, res) => {
  try {
    const { status } = req.query;
    const args = [];
    let sql = `SELECT * FROM companies`;
    if (status === "active" || status === "inactive") {
      sql += ` WHERE status = ?`;
      args.push(status);
    }
    sql += ` ORDER BY created_at DESC`;

    const [rows] = await pool.query(sql, args);

    // Attach documents_count
    const ids = rows.map(r => r.company_id);
    let docCounts = {};
    if (ids.length) {
      const [counts] = await pool.query(
        `SELECT company_id, COUNT(*) AS c
         FROM company_documents
         WHERE company_id IN (${ids.map(()=>"?").join(",")})
         GROUP BY company_id`,
        ids
      );
      for (const c of counts) docCounts[c.company_id] = c.c;
    }

    return res.json({
      data: rows.map(r => ({ ...mapCompanyRow(r), documents_count: docCounts[r.company_id] || 0 }))
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/v1/companies/:id
 * Any authenticated user
 */
export const getCompany = async (req, res) => {
  try {
    const id = (req.params.id || "").trim(); // string like company001
    const [rows] = await pool.query(`SELECT * FROM companies WHERE company_id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Not found" });

    const [docs] = await pool.query(
      `SELECT doc_id, filename, mime, size_bytes, uploaded_by, created_at
       FROM company_documents WHERE company_id = ? ORDER BY created_at DESC`,
      [id]
    );

    return res.json({ data: { ...mapCompanyRow(rows[0]), documents: docs.map(mapDocMeta) } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/v1/companies/:id/documents/:doc_id
 * Binary download
 */
export const downloadCompanyDoc = async (req, res) => {
  try {
    const companyId = (req.params.id || "").trim();
    const docId = (req.params.doc_id || "").trim();

    const [rows] = await pool.query(
      `SELECT filename, mime, size_bytes, data
       FROM company_documents
       WHERE company_id = ? AND doc_id = ?`,
      [companyId, docId]
    );

    if (!rows.length || !rows[0].data) return res.status(404).json({ message: "Document not found" });

    const doc = rows[0];
    res.setHeader("Content-Type", doc.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.filename)}"`);
    return res.send(doc.data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PATCH /api/v1/companies/:id
 * Employees only
 * - Update fields
 * - Append documents[] (optional)
 * - Remove docs by ids: remove_doc_ids="doc001,doc002"
 */
export const updateCompany = async (req, res) => {
  const id = (req.params.id || "").trim();

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;
  const docs = Array.isArray(req.files) ? req.files : [];
  const uploader = req.user.employee_id;

  const sets = [];
  const args = [];
  const set = (k, v) => { sets.push(`${k} = ?`); args.push(v); };

  if (b.company_name) set("company_name", b.company_name.trim());
  if (b.company_email) set("company_email", b.company_email.toLowerCase().trim());
  if (b.company_contact) set("company_contact", b.company_contact.trim());
  if (typeof b.company_website === "string") set("company_website", b.company_website.trim() || null);
  if (b.industry) set("industry", b.industry.trim());
  if (b.address) set("address", b.address.trim());
  if (b.contact_person_name) set("contact_person_name", b.contact_person_name.trim());
  if (typeof b.notes === "string") set("notes", b.notes.trim() || null);
  if (typeof b.status === "string") {
    const st = b.status.trim();
    if (!["active", "inactive"].includes(st))
      return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
    set("status", st);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ensure exists
    const [exists] = await conn.query(`SELECT company_id FROM companies WHERE company_id = ?`, [id]);
    if (!exists.length) {
      await conn.query("ROLLBACK");
      return res.status(404).json({ message: "Not found" });
    }

    if (sets.length) {
      args.push(id);
      await conn.query(`UPDATE companies SET ${sets.join(", ")} WHERE company_id = ?`, args);
    }

    // remove docs by IDs (optional)
    if (b.remove_doc_ids) {
      const ids = String(b.remove_doc_ids)
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
      if (ids.length) {
        await conn.query(
          `DELETE FROM company_documents
           WHERE company_id = ? AND doc_id IN (${ids.map(()=>"?").join(",")})`,
          [id, ...ids]
        );
      }
    }

    // append new docs (optional)
    for (const f of docs) {
      const doc_id = await nextId(conn, "doc", "doc", 3);
      await conn.query(
        `INSERT INTO company_documents
         (doc_id, company_id, filename, mime, size_bytes, data, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [doc_id, id, f.originalname, f.mimetype || null, f.size || null, f.buffer || null, uploader]
      );
    }

    await conn.commit();

    const [[row]] = await pool.query(`SELECT * FROM companies WHERE company_id = ?`, [id]);
    const [docRows] = await pool.query(
      `SELECT doc_id, filename, mime, size_bytes, uploaded_by, created_at
       FROM company_documents WHERE company_id = ? ORDER BY created_at DESC`,
      [id]
    );

    return res.json({ message: "Updated", data: { ...mapCompanyRow(row), documents: docRows.map(mapDocMeta) } });
  } catch (err) {
    await conn.query("ROLLBACK");
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Company email already exists" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to update company" });
  } finally {
    conn.release();
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [result] = await pool.query(`DELETE FROM companies WHERE company_id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};
