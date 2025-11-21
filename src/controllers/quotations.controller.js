// src/controllers/quotations.controller.js
import { pool } from "../config/db.js";
import { validationResult } from "express-validator";
import { nextId } from "../utils/id.generator.js";
import multer from "multer";
import fs from "fs";
import path from "path";

/* ───────────────────────────── Helpers ───────────────────────────── */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}
function sumMoney(nums) {
  return +nums.reduce((a, b) => a + Number(b || 0), 0).toFixed(2);
}
function computeTotals(items, taxRate, discount) {
  const subtotal = sumMoney(items.map(i => i.amount));
  const tax_amount = +((subtotal * (Number(taxRate || 0) / 100))).toFixed(2);
  const total_before_discount = subtotal + tax_amount;
  const total_amount = +(total_before_discount - Number(discount || 0)).toFixed(2);
  return { subtotal, tax_amount, total_amount };
}
function parseItems(itemsStr) {
  let arr = [];
  try { arr = typeof itemsStr === "string" ? JSON.parse(itemsStr) : itemsStr; }
  catch { throw new Error("items must be valid JSON"); }
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("items required");
  return arr.map((it, idx) => {
    const particulars = String(it.particulars || "").trim();
    const qty = Number(it.qty);
    const rate = Number(it.rate);
    if (!particulars) throw new Error(`items[${idx}].particulars required`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`items[${idx}].qty must be > 0`);
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`items[${idx}].rate must be >= 0`);
    return { particulars, qty, rate, amount: +(qty * rate).toFixed(2), position: idx + 1 };
  });
}
function relUploadPath(absPath) {
  return path.relative(process.cwd(), absPath).replace(/\\/g, "/");
}

/* ────────────────────── Multer (cover_photo) ─────────────────────── */
const QUOTES_DIR = path.join(process.cwd(), "uploads", "quotations");
if (!fs.existsSync(QUOTES_DIR)) fs.mkdirSync(QUOTES_DIR, { recursive: true });

const coverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, QUOTES_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});
export const uploadCover = multer({ storage: coverStorage });

/* ─────────────────────── CREATE: POST /api/quotations ─────────────────────── */
export const createQuotation = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;
  const user = req.user;

  // ✅ Parse items safely
  let items;
  try {
    items = parseItems(b.items);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  // ✅ Dates and totals
  const quotation_date = b.quotation_date || todayISO();
  const validity_days = Number(b.validity_days || 30);
  const valid_until = addDays(quotation_date, validity_days);

  const tax_rate = Number(b.tax_rate || 0);
  const discount_amount = Number(b.discount_amount || 0);
  const { subtotal, tax_amount, total_amount } = computeTotals(items, tax_rate, discount_amount);

  // ✅ Cover photo upload
  const cover = req.file; // expects multer upload
  const cover_image_path = cover ? relUploadPath(cover.path) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ✅ Generate new quotation ID
    const quotation_id = await nextId(conn, "quotation", "QTO-", 4);
    const quotation_no = quotation_id;

    // ✅ Insert into quotations table
    await conn.query(
      `INSERT INTO quotations
       (quotation_id, quotation_no,
        lead_number, company_name, contact_person_name, address,
        cover_image_path,
        reference_no, quotation_date, validity_days, valid_until,
        currency, tax_rate, discount_amount,
        subject, cover_body,
        customer_type, bill_reference, period, existing_kwh, existing_kvah, effective_pf,
        per_unit_rate, per_unit_rate_with_taxes, demand_rate,
        existing_kva_demand, existing_kw_demand, grand_total,
        subtotal, tax_amount, total_amount,
        created_by, quotation_stage, status, quotation_status)
       VALUES (?,?,?,?,?,
               ?, 
               ?,?,?,?,?,
               ?,?,?,?,
               ?,?,
               ?,?,?,?,?,?,
               ?,?,?,?,
               ?,?,?,
               ?,?,?,?,?)`,
      [
        quotation_id, quotation_no,
        b.lead_number || null, b.company_name || null, b.contact_person_name || null, b.address || null,
        cover_image_path,
        b.reference_no || null, quotation_date, validity_days, valid_until,
        b.currency || "INR", tax_rate, discount_amount,
        b.subject || null, b.cover_body || null,
        b.customer_type || null, b.bill_reference || null, b.period || null,
        b.existing_kwh || null, b.existing_kvah || null, b.effective_pf || null,
        b.per_unit_rate || null, b.per_unit_rate_with_taxes || null, b.demand_rate || null,
        b.existing_kva_demand || null, b.existing_kw_demand || null, b.grand_total || null,
        subtotal, tax_amount, total_amount,
        user.employee_id, "draft", "pending", (b.quotation_status || "saved").toLowerCase()
      ]
    );

    // ✅ Insert quotation items
    for (const it of items) {
      await conn.query(
        `INSERT INTO quotation_items (quotation_id, position, particulars, qty, rate, amount)
         VALUES (?,?,?,?,?,?)`,
        [quotation_id, it.position, it.particulars, it.qty, it.rate, it.amount]
      );
    }

    // ✅ Log activity in lead_activity_backup table
    if (b.lead_number) {
      await conn.query(
        `INSERT INTO lead_activity_backup
         (lead_id, changed_by, changed_by_department, changed_by_role, change_type, reason, new_assigned_employee)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          b.lead_number,
          user.employee_id,
          user.department_id,
          user.role_id,
          "quotation_created",
          "Quotation created by employee",
          user.employee_id
        ]
      );
    }

    await conn.commit();

    // ✅ Return full quotation with items
    const [[q]] = await pool.query(`SELECT * FROM quotations WHERE quotation_id = ?`, [quotation_id]);
    const [lines] = await pool.query(
      `SELECT item_id, position, particulars, qty, rate, amount
       FROM quotation_items WHERE quotation_id = ? ORDER BY position ASC, item_id ASC`,
      [quotation_id]
    );

    return res.status(201).json({
      message: "Quotation created successfully",
      data: { ...q, items: lines },
    });
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("Create quotation error:", err);
    return res.status(500).json({ message: "Failed to create quotation" });
  } finally {
    conn.release();
  }
};


/* ─────────────────────── LIST: GET /api/quotations ─────────────────────── */
export const listQuotations = async (req, res) => {
  try {
    const { status, quotation_status, q } = req.query;
    const where = [], args = [];
    if (status) { where.push("qq.status = ?"); args.push(status); }
    if (quotation_status) { where.push("qq.quotation_status = ?"); args.push(quotation_status); }
    if (q) {
      const like = `%${q}%`;
      where.push("(qq.quotation_no LIKE ? OR qq.company_name LIKE ? OR qq.subject LIKE ?)");
      args.push(like, like, like);
    }

    let sql = `
      SELECT qq.*, COUNT(qi.item_id) AS total_items
      FROM quotations qq
      LEFT JOIN quotation_items qi ON qi.quotation_id = qq.quotation_id
    `;
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " GROUP BY qq.quotation_id ORDER BY qq.created_at DESC";

    const [rows] = await pool.query(sql, args);
    return res.json({ data: rows });
  } catch (err) {
    console.error("List quotations error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ─────────────── GET ONE: GET /api/quotations/:id ─────────────── */
export const getQuotation = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [[q]] = await pool.query(`SELECT * FROM quotations WHERE quotation_id = ?`, [id]);
    if (!q) return res.status(404).json({ message: "Not found" });

    const [lines] = await pool.query(
      `SELECT item_id, position, particulars, qty, rate, amount
       FROM quotation_items WHERE quotation_id = ? ORDER BY position ASC, item_id ASC`,
      [id]
    );

    // add a computed file_url for convenience (served by app.use("/uploads", …))
    const file_url = q.cover_image_path ? `/` + q.cover_image_path.replace(/\\/g, "/") : null;

    return res.json({ data: { ...q, cover_file_url: file_url, items: lines } });
  } catch (err) {
    console.error("Get quotation error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};


/**
 * GET /api/v1/quotations/my
 * Fetch all quotations created by the logged-in employee
 */
export const listMyQuotations = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(401).json({ message: "Unauthorized: Invalid employee token" });
    }

    // ✅ Automatically inactivate expired quotations
    await pool.query(`
      UPDATE quotations
      SET status = 'inactive'
      WHERE status = 'active' AND valid_until < CURRENT_DATE;
    `);

    // ✅ Fetch quotations created by this employee
    const [quotations] = await pool.query(
      `
      SELECT 
        q.quotation_id,
        q.quotation_no,
        q.lead_number,
        q.company_name,
        q.contact_person_name,
        q.address,
        q.reference_no,
        q.quotation_date,
        q.validity_days,
        q.valid_until,
        q.currency,
        q.tax_rate,
        q.discount_amount,
        q.subtotal,
        q.tax_amount,
        q.total_amount,
        q.grand_total,
        q.customer_type,
        q.bill_reference,
        q.period,
        q.subject,
        q.cover_body,
        q.status,
        q.quotation_stage,
        q.quotation_status,
        q.created_at,
        q.updated_at
      FROM quotations q
      WHERE q.created_by = ?
      ORDER BY q.created_at DESC
      `,
      [employeeId]
    );

    if (!quotations.length) {
      return res.status(200).json({
        message: "No quotations found for this employee.",
        employee_id: employeeId,
        total: 0,
        quotations: [],
      });
    }

    // ✅ Attach cost items for each quotation
    for (const q of quotations) {
      const [items] = await pool.query(
        `SELECT item_id, particulars, qty, rate, amount
         FROM quotation_items
         WHERE quotation_id = ?
         ORDER BY position ASC`,
        [q.quotation_id]
      );
      q.items = items;
    }

    return res.status(200).json({
      message: "Quotations fetched successfully",
      employee_id: employeeId,
      total: quotations.length,
      quotations,
    });
  } catch (error) {
    console.error("Error fetching quotations by employee:", error);
    return res.status(500).json({ message: "Server error while fetching quotations" });
  }
};



/* ───────────────────── UPDATE: PUT /api/quotations/:id ──────────────────── */
/* --------------------- Safe Date Helper --------------------- */
function addDaysSafe(dateStr, days = 0) {
  let d;

  if (!dateStr) {
    d = new Date(); // fallback to today
  } else if (dateStr instanceof Date) {
    d = new Date(dateStr);
  } else {
    const parsed = new Date(`${dateStr}T00:00:00Z`);
    d = isNaN(parsed) ? new Date() : parsed;
  }

  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/* ---------------------- Update Quotation ---------------------- */
export const updateQuotation = async (req, res) => {
  const id = (req.params.id || "").trim();
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const b = req.body;
  const cover = req.file;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 🔒 Lock current row
    const [[current]] = await conn.query(
      `SELECT * FROM quotations WHERE quotation_id = ? FOR UPDATE`,
      [id]
    );
    if (!current) {
      await conn.query("ROLLBACK");
      return res.status(404).json({ message: "Quotation not found" });
    }

    // 🚫 Prevent editing sent quotations
    if (current.quotation_status !== "saved" && current.quotation_status !== "draft") {
      await conn.query("ROLLBACK");
      return res.status(409).json({
        message: "Quotation cannot be updated once emailed or approved."
      });
    }

    // ✅ Optional company change
    let companyIdToUse = current.company_id;
    if (b.company_id || b.company_name) {
      const company = await resolveCompanyId(b.company_id, b.company_name);
      if (!company) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid company (by id or name)" });
      }
      companyIdToUse = company.company_id;
    }

    // ✅ Handle items if provided
    let newItems = null;
    if (typeof b.items === "string") {
      try {
        newItems = JSON.parse(b.items);
      } catch (err) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid items JSON format" });
      }
    }

    // ✅ Determine tax rate
    const taxRateToUse =
      b.tax_rate !== undefined ? Number(b.tax_rate) : Number(current.tax_rate);
    if (Number.isNaN(taxRateToUse) || taxRateToUse < 0) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: "tax_rate must be >= 0" });
    }

    // ✅ Compute totals
    let subtotal = 0;
    if (newItems && newItems.length > 0) {
      subtotal = newItems.reduce(
        (sum, i) => sum + (Number(i.qty) * Number(i.rate) || 0),
        0
      );
    } else {
      const [sumRes] = await conn.query(
        `SELECT SUM(amount) AS total FROM quotation_items WHERE quotation_id = ?`,
        [id]
      );
      subtotal = Number(sumRes[0].total || 0);
    }
    const tax_amount = +(subtotal * (taxRateToUse / 100)).toFixed(2);
    const total_amount = +(subtotal + tax_amount).toFixed(2);

    // ✅ Handle dates safely
    const quotation_date = b.quotation_date || current.quotation_date;
    const validity_days =
      b.validity_days !== undefined
        ? Number(b.validity_days)
        : Number(current.validity_days || 30);

    if (!Number.isFinite(validity_days) || validity_days <= 0) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: "validity_days must be > 0" });
    }

    const valid_until = addDaysSafe(quotation_date, validity_days);

    // ✅ Update fields dynamically
    const sets = [];
    const args = [];
    const set = (col, val) => {
      sets.push(`${col} = ?`);
      args.push(val);
    };

    if (b.lead_number) set("lead_number", b.lead_number);
    if (companyIdToUse !== current.company_id) set("company_id", companyIdToUse);
    if (b.contact_person_name) set("contact_person_name", b.contact_person_name.trim());
    if (b.address) set("address", b.address.trim());
    if (b.reference_no !== undefined) set("reference_no", b.reference_no || null);
    if (b.currency) set("currency", b.currency.trim());
    if (b.subject) set("subject", b.subject.trim());
    if (b.cover_body) set("cover_body", b.cover_body.trim());
    if (b.discount_amount !== undefined)
      set("discount_amount", Number(b.discount_amount) || 0);

    set("quotation_date", quotation_date);
    set("validity_days", validity_days);
    set("valid_until", valid_until);
    set("tax_rate", taxRateToUse);
    set("subtotal", subtotal);
    set("tax_amount", tax_amount);
    set("total_amount", total_amount);

    // ✅ Cover Image
    if (cover) {
      const uploadDir = path.join(process.cwd(), "uploads/quotations");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const filePath = path.join(
        uploadDir,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(
          cover.originalname
        )}`
      );
      fs.writeFileSync(filePath, cover.buffer);
      set("cover_image_path", filePath.replace(process.cwd(), "").replace(/\\/g, "/"));
    }

    if (sets.length) {
      args.push(id);
      await conn.query(`UPDATE quotations SET ${sets.join(", ")} WHERE quotation_id = ?`, args);
    }

    // ✅ Replace items if provided
    if (newItems && newItems.length > 0) {
      await conn.query(`DELETE FROM quotation_items WHERE quotation_id = ?`, [id]);
      for (const [idx, item] of newItems.entries()) {
        await conn.query(
          `INSERT INTO quotation_items (quotation_id, position, particulars, qty, rate, amount)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            idx + 1,
            item.particulars,
            item.qty,
            item.rate,
            item.qty * item.rate,
          ]
        );
      }
    }

    await conn.commit();

    // ✅ Return updated record
    const [[updated]] = await pool.query(
      `SELECT * FROM quotations WHERE quotation_id = ?`,
      [id]
    );
    const [items] = await pool.query(
      `SELECT item_id, particulars, qty, rate, amount
       FROM quotation_items WHERE quotation_id = ? ORDER BY position ASC`,
      [id]
    );

    return res.status(200).json({
      message: "Quotation updated successfully",
      data: { ...updated, items },
    });
  } catch (error) {
    await conn.query("ROLLBACK");
    console.error("Update quotation error:", error);
    return res.status(500).json({ message: "Failed to update quotation" });
  } finally {
    conn.release();
  }
};


/* ───────────────────── DELETE: DELETE /api/quotations/:id ─────────────────── */
export const deleteQuotation = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [r] = await pool.query(`DELETE FROM quotations WHERE quotation_id = ?`, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete quotation error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const patchQuotationStatus = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const { status, quotation_status, reason } = req.body;
    const user = req.user;

    if (!id) return res.status(400).json({ message: "Quotation ID is required" });

    // ✅ Allowed values
    const okApproval = ["pending", "approved", "rejected"];
    const okQStatus = ["saved", "draft", "emailed"];

    const sets = [];
    const args = [];

    // ✅ Validation for status
    if (status) {
      const s = String(status).toLowerCase();
      if (!okApproval.includes(s))
        return res.status(400).json({ message: "Invalid status (pending/approved/rejected)" });

      // if rejected → reason required
      if (s === "rejected" && !reason)
        return res.status(400).json({ message: "Rejection reason is required" });

      sets.push("status = ?");
      args.push(s);
    }

    // ✅ Validation for quotation_status
    if (quotation_status) {
      const qs = String(quotation_status).toLowerCase();
      if (!okQStatus.includes(qs))
        return res.status(400).json({
          message: "Invalid quotation_status (saved/draft/emailed)",
        });
      sets.push("quotation_status = ?");
      args.push(qs);
    }

    if (!sets.length)
      return res.status(400).json({ message: "Nothing to update" });

    args.push(id);

    // ✅ Update quotations table
    const [r] = await pool.query(
      `UPDATE quotations SET ${sets.join(", ")}, updated_at = NOW() WHERE quotation_id = ?`,
      args
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ message: "Quotation not found" });

    // ✅ Fetch lead_id (lead_number) for logging
    const [[quotation]] = await pool.query(
      `SELECT quotation_id, lead_number, status, quotation_status FROM quotations WHERE quotation_id = ?`,
      [id]
    );

    // ✅ Insert log into lead_activity_backup
    let logMessage = "";
    let changeType = "";

    if (status?.toLowerCase() === "approved") {
      changeType = "quotation_approved";
      logMessage = "Quotation approved by employee.";
    } else if (status?.toLowerCase() === "rejected") {
      changeType = "quotation_rejected";
      logMessage = `Quotation rejected by employee. Reason: ${reason}`;
    } else if (quotation_status) {
      changeType = "quotation_status_update";
      logMessage = `Quotation status updated to ${quotation_status}`;
    }

    if (changeType && quotation?.lead_number) {
      await pool.query(
        `INSERT INTO lead_activity_backup 
         (lead_id, changed_by, changed_by_department, changed_by_role, change_type, reason, new_assigned_employee)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          quotation.lead_number,
          user.employee_id,
          user.department_id,
          user.role_id,
          changeType,
          logMessage,
          user.employee_id
        ]
      );
    }

    return res.json({
      message: "Quotation status updated successfully",
      data: {
        quotation_id: quotation.quotation_id,
        lead_number: quotation.lead_number,
        status: quotation.status,
        quotation_status: quotation.quotation_status,
      },
    });
  } catch (err) {
    console.error("Patch status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};


export const getApprovedQuotations = async (req, res) => {
  try {
    // Fetch all quotations with status 'approved'
    const [rows] = await pool.query(
      `SELECT 
        quotation_id,
        quotation_no,
        lead_number,
        company_name,
        contact_person_name,
        address,
        quotation_date,
        validity_days,
        valid_until,
        currency,
        tax_rate,
        discount_amount,
        subtotal,
        tax_amount,
        total_amount,
        customer_type,
        bill_reference,
        period,
        status,
        quotation_status,
        quotation_stage,
        created_by,
        created_at,
        updated_at
       FROM quotations
       WHERE status = 'approved'
       ORDER BY created_at DESC`
    );

    if (!rows.length) {
      return res.status(200).json({
        message: "No approved quotations found",
        total: 0,
        quotations: [],
      });
    }

    // Fetch items for each quotation
    for (const q of rows) {
      const [items] = await pool.query(
        `SELECT item_id, particulars, qty, rate, amount
         FROM quotation_items
         WHERE quotation_id = ?
         ORDER BY position ASC`,
        [q.quotation_id]
      );
      q.items = items;
    }

    return res.status(200).json({
      message: "Approved quotations fetched successfully",
      total: rows.length,
      quotations: rows,
    });
  } catch (err) {
    console.error("Error fetching approved quotations:", err);
    return res.status(500).json({ message: "Server error while fetching approved quotations" });
  }
};


export const getQuotationTeamLeads = async (req, res) => {
  try {
    const [leads] = await pool.query(
      `SELECT 
         lead_id,
         lead_name,
         company_name,
         contact_person_name,
         contact_person_phone,
         contact_person_email,
         company_address,
         company_country,
         company_state,
         company_city,
         lead_stage,
         assigned_employee,
         created_at,
         updated_at
       FROM leads
       WHERE lead_stage = 'Quotation-Team'
       ORDER BY created_at DESC`
    );

    if (!leads.length) {
      return res.status(200).json({
        message: "No leads found in Quotation-Team stage",
        total: 0,
        leads: [],
      });
    }

    return res.status(200).json({
      message: "Leads in Quotation-Team stage fetched successfully",
      total: leads.length,
      leads,
    });
  } catch (err) {
    console.error("Error fetching Quotation-Team leads:", err);
    return res.status(500).json({ message: "Server error while fetching leads" });
  }
};




export const getPaymentsTeamLeadsWithQuotations = async (req, res) => {
  try {
    // Step 1️⃣ — Fetch all leads under "Payments-Team"
    const [leads] = await pool.query(
      `SELECT 
         lead_id,
         lead_name,
         company_name,
         contact_person_name,
         contact_person_phone,
         contact_person_email,
         lead_stage,
         lead_status,
         assigned_employee,
         created_by,
         created_at,
         updated_at
       FROM leads
       WHERE lead_stage = 'Payments-Team'
       ORDER BY created_at DESC`
    );

    if (leads.length === 0) {
      return res.status(200).json({
        message: "No leads found under Payments-Team stage",
        total_leads: 0,
        leads: [],
      });
    }

    // Step 2️⃣ — Fetch approved quotations for each lead
    for (const lead of leads) {
      const [approvedQuotations] = await pool.query(
        `SELECT 
           quotation_id,
           quotation_no,
           lead_number,
           company_name,
           contact_person_name,
           address,
           cover_image_path,
           reference_no,
           quotation_date,
           validity_days,
           valid_until,
           currency,
           tax_rate,
           discount_amount,
           subject,
           cover_body,
           customer_type,
           bill_reference,
           period,
           existing_kwh,
           existing_kvah,
           effective_pf,
           per_unit_rate,
           per_unit_rate_with_taxes,
           demand_rate,
           existing_kva_demand,
           existing_kw_demand,
           grand_total,
           subtotal,
           tax_amount,
           total_amount,
           quotation_stage,
           status,
           quotation_status,
           created_by,
           created_at,
           updated_at
         FROM quotations
         WHERE lead_number = ? AND status = 'approved'
         ORDER BY created_at DESC`,
        [lead.lead_id] // quotations.lead_number stores the lead_id
      );

      lead.approved_quotations = approvedQuotations;
    }

    // Step 3️⃣ — Filter out leads with no approved quotations
    const leadsWithApproved = leads.filter((l) => l.approved_quotations.length > 0);

    return res.status(200).json({
      message: "Payments-Team leads with approved quotations fetched successfully",
      total_leads: leadsWithApproved.length,
      leads: leadsWithApproved,
    });
  } catch (error) {
    console.error("Error fetching Payments-Team leads with approved quotations:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

