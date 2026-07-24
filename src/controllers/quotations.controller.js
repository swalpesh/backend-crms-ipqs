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
 * GET /api/v1/quotations/all
 * Fetch all quotations created by all employees across the company
 */
export const listMyQuotations = async (req, res) => {
  try {
    // We still check for a valid token to ensure the user is logged in
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

    // ✅ Fetch ALL quotations from the system (Removed the WHERE filter)
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
        q.updated_at,
        q.created_by -- Added so the frontend knows who owns this quotation
      FROM quotations q
      ORDER BY q.created_at DESC
      `
    );

    if (!quotations.length) {
      return res.status(200).json({
        message: "No quotations found in the system.",
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
      message: "All quotations fetched successfully",
      total: quotations.length,
      quotations,
    });
  } catch (error) {
    console.error("Error fetching all quotations:", error);
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
    // ✅ 1. Fetch ALL columns (*) from the leads table
    const [leads] = await pool.query(
      `SELECT *
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

    // ✅ 2. Fetch and append attachments for complete context
    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
      
      // Optional: If you also want to attach the assigned employee's details
      if (lead.assigned_employee && lead.assigned_employee !== "0") {
        const [emp] = await pool.query(
          "SELECT employee_id, username, email, role_id, department_id FROM employees WHERE employee_id = ?",
          [lead.assigned_employee]
        );
        lead.assigned_employee_details = emp.length ? emp[0] : null;
      } else {
        lead.assigned_employee_details = null;
      }
    }

    // ✅ 3. Return the fully populated data
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




/* -------------------------------------------------------------------------- */
/* SEND LEAD BACK TO ORIGIN AFTER QUOTATION (2-Step Smart Hunt)               */
/* -------------------------------------------------------------------------- */
// export const transferLeadBackFromQuotation = async (req, res) => {
//   try {
//     const { lead_id, new_lead_stage, assigned_employee, reason } = req.body;
    
//     // Extract acting user details from the JWT
//     const userId = req.user.employee_id;
//     const departmentId = req.user.department_id;
//     const roleId = req.user.role_id;

//     // ✅ Security: Restrict to Quotation Team & IPQS Head
//     const allowedRoles = [
//       "IpqsHead",
//       "Quotation-Team-Head",
//       "Quotation-Team-Employee",
//     ];

//     if (!allowedRoles.includes(roleId)) {
//       return res.status(403).json({
//         error: "Forbidden: You are not allowed to transfer leads.",
//       });
//     }

//     // ✅ Basic Validation
//     if (!lead_id) {
//       return res.status(400).json({ error: "lead_id is required." });
//     }

//     // ✅ Fetch Current Lead Data
//     const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    
//     if (leadData.length === 0) {
//       return res.status(404).json({ error: "Lead not found." });
//     }
//     const oldLead = leadData[0];

//     // =========================================================================
//     // ✅ NEW LOGIC: 2-STEP SMART HUNT
//     // =========================================================================
//     let final_lead_stage = new_lead_stage; 
//     let final_assigned_employee = assigned_employee; 

//     // Fetch history going FORWARDS (oldest first - ID 1, 2, 3...)
//     const [history] = await pool.query(
//       `SELECT * FROM lead_activity_backup WHERE lead_id = ? ORDER BY id ASC`,
//       [lead_id]
//     );

//     let targetStage = null;

//     // STEP 1: Find the target stage (The first stage that is NOT Tele-Marketing)
//     for (const log of history) {
//       if (log.new_lead_stage && !log.new_lead_stage.toLowerCase().includes('tele')) {
//         targetStage = log.new_lead_stage; // e.g., 'Solutions-Team' or 'Field Marketing'
//         break; 
//       }
//     }

//     // STEP 2: Find the real person associated with that specific target stage
//     if (targetStage) {
//       for (const log of history) {
        
//         // Scenario A: Did a real person receive it when it entered this stage?
//         if (log.new_lead_stage === targetStage && log.new_assigned_employee && log.new_assigned_employee !== "0") {
//           final_assigned_employee = log.new_assigned_employee;
//           final_lead_stage = targetStage;
//           break;
//         }
        
//         // Scenario B: Did a real person move it out of this stage? 
//         if (log.old_lead_stage === targetStage && log.changed_by && log.changed_by !== "0") {
//           final_assigned_employee = log.changed_by;
//           final_lead_stage = targetStage;
//           break;
//         }

//         // Scenario C: Was a real person holding it when it moved?
//         if (log.old_lead_stage === targetStage && log.old_assigned_employee && log.old_assigned_employee !== "0") {
//           final_assigned_employee = log.old_assigned_employee;
//           final_lead_stage = targetStage;
//           break;
//         }
//       }
//     }
//     // =========================================================================

//     // ✅ Safety fallback
//     if (!final_lead_stage || !final_assigned_employee || final_assigned_employee === "0") {
//       return res.status(400).json({ 
//         error: "Could not determine a valid real employee to send the lead back to." 
//       });
//     }

//     // ✅ UPDATE QUERY: Changes stage, assigns to the calculated employee, forces 'follow-up'
//     await pool.query(
//       `UPDATE leads 
//        SET lead_stage = ?, 
//            assigned_employee = ?, 
//            lead_status = 'follow-up', 
//            updated_at = NOW()
//        WHERE lead_id = ?`,
//       [final_lead_stage, final_assigned_employee, lead_id]
//     );

//     // ✅ BACKUP QUERY: Logs the exact user and reason for the transfer back
//     await pool.query(
//       `INSERT INTO lead_activity_backup 
//        (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee,
//         changed_by, changed_by_department, changed_by_role, change_type, reason)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         lead_id,
//         oldLead.lead_stage,
//         final_lead_stage,
//         oldLead.assigned_employee,
//         final_assigned_employee, 
//         userId,
//         departmentId,
//         roleId,
//         "lead_transferred_back",
//         reason || "Quotation generated. Lead sent back to the appropriate department."
//       ]
//     );

//     // ✅ Success Response
//     res.status(200).json({
//       message: `Lead ${lead_id} successfully sent back to ${final_lead_stage}.`,
//       lead_id,
//       old_lead_stage: oldLead.lead_stage,
//       new_lead_stage: final_lead_stage,
//       assigned_employee: final_assigned_employee, 
//       lead_status: "follow-up",
//       reason: reason || "Quotation generated. Lead sent back to the appropriate department."
//     });

//   } catch (error) {
//     console.error("Error transferring lead back from quotation:", error);
//     res.status(500).json({ error: "Server error while transferring lead back." });
//   }
// };

/* -------------------------------------------------------------------------- */
/* SEND LEAD BACK TO ORIGIN AFTER QUOTATION (Returns to Creator)              */
/* -------------------------------------------------------------------------- */
export const transferLeadBackFromQuotation = async (req, res) => {
  try {
    const { lead_id, new_lead_stage, assigned_employee, reason } = req.body;
    
    // Extract acting user details from the JWT
    const userId = req.user.employee_id;
    const departmentId = req.user.department_id;
    const roleId = req.user.role_id;

    // ✅ Security: Restrict to Quotation Team & IPQS Head
    const allowedRoles = [
      "IpqsHead",
      "Quotation-Team-Head",
      "Quotation-Team-Employee",
    ];

    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not allowed to transfer leads.",
      });
    }

    // ✅ Basic Validation
    if (!lead_id) {
      return res.status(400).json({ error: "lead_id is required." });
    }

    // ✅ Fetch Current Lead Data
    const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    
    if (leadData.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }
    const oldLead = leadData[0];

    // =========================================================================
    // ✅ NEW LOGIC: RETURN TO EXACT ORIGIN (STARTING STAGE & CREATOR)
    // =========================================================================
    let final_lead_stage = new_lead_stage; 
    let final_assigned_employee = assigned_employee; 

    // Fetch ONLY the very first log entry to find where this lead started
    const [history] = await pool.query(
      `SELECT * FROM lead_activity_backup WHERE lead_id = ? ORDER BY id ASC LIMIT 1`,
      [lead_id]
    );

    if (history.length > 0) {
      const firstLog = history[0];
      
      // STEP 1: Set the stage to the very first stage recorded (includes Tele-Marketing)
      final_lead_stage = firstLog.new_lead_stage || firstLog.old_lead_stage || oldLead.lead_stage;
      
      // STEP 2: Assign to the CREATOR instead of the assigned person.
      // (Checks for a created_by column on the lead, falls back to the user who made the first log)
      final_assigned_employee = oldLead.created_by || firstLog.changed_by;
    }
    // =========================================================================

    // ✅ Safety fallback
    if (!final_lead_stage || !final_assigned_employee || final_assigned_employee === "0") {
      return res.status(400).json({ 
        error: "Could not determine the original creator to send the lead back to." 
      });
    }

    // ✅ UPDATE QUERY: Changes stage, assigns to the creator, forces 'follow-up'
    await pool.query(
      `UPDATE leads 
       SET lead_stage = ?, 
           assigned_employee = ?, 
           lead_status = 'follow-up', 
           updated_at = NOW()
       WHERE lead_id = ?`,
      [final_lead_stage, final_assigned_employee, lead_id]
    );

    // ✅ BACKUP QUERY: Logs the exact user and reason for the transfer back
    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee,
        changed_by, changed_by_department, changed_by_role, change_type, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        oldLead.lead_stage,
        final_lead_stage,
        oldLead.assigned_employee,
        final_assigned_employee, 
        userId,
        departmentId,
        roleId,
        "lead_transferred_back",
        reason || "Quotation generated. Lead sent back to the original creator."
      ]
    );

    // ✅ Success Response
    res.status(200).json({
      message: `Lead ${lead_id} successfully sent back to creator at ${final_lead_stage}.`,
      lead_id,
      old_lead_stage: oldLead.lead_stage,
      new_lead_stage: final_lead_stage,
      assigned_employee: final_assigned_employee, 
      lead_status: "follow-up",
      reason: reason || "Quotation generated. Lead sent back to the original creator."
    });

  } catch (error) {
    console.error("Error transferring lead back from quotation:", error);
    res.status(500).json({ error: "Server error while transferring lead back." });
  }
};


/* ─────────────────────── UPDATE: PUT /api/quotations/:id ─────────────────────── */
export const updateQuotation = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const id = (req.params.id || "").trim();
  const b = req.body;
  const user = req.user;

  // ✅ 1. Check if the quotation exists
  const [[existingQuote]] = await pool.query(`SELECT * FROM quotations WHERE quotation_id = ?`, [id]);
  if (!existingQuote) return res.status(404).json({ message: "Quotation not found" });

  // ✅ 2. Parse items safely
  let items;
  try {
    items = parseItems(b.items);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  // ✅ 3. Dates and totals (fallback to existing data if not provided)
  const quotation_date = b.quotation_date || existingQuote.quotation_date;
  const validity_days = Number(b.validity_days || existingQuote.validity_days);
  const valid_until = addDays(quotation_date, validity_days);

  const tax_rate = Number(b.tax_rate || 0);
  const discount_amount = Number(b.discount_amount || 0);
  const { subtotal, tax_amount, total_amount } = computeTotals(items, tax_rate, discount_amount);

  // ✅ 4. Cover photo upload logic (keep old image if no new one is uploaded)
  const cover = req.file; 
  const cover_image_path = cover ? relUploadPath(cover.path) : existingQuote.cover_image_path;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ✅ 5. Update the quotations table
    await conn.query(
      `UPDATE quotations SET
        lead_number = ?, company_name = ?, contact_person_name = ?, address = ?,
        cover_image_path = ?, reference_no = ?, quotation_date = ?, validity_days = ?,
        valid_until = ?, currency = ?, tax_rate = ?, discount_amount = ?,
        subject = ?, cover_body = ?, customer_type = ?, bill_reference = ?,
        period = ?, existing_kwh = ?, existing_kvah = ?, effective_pf = ?,
        per_unit_rate = ?, per_unit_rate_with_taxes = ?, demand_rate = ?,
        existing_kva_demand = ?, existing_kw_demand = ?, grand_total = ?,
        subtotal = ?, tax_amount = ?, total_amount = ?,
        quotation_status = ?
       WHERE quotation_id = ?`,
      [
        b.lead_number !== undefined ? b.lead_number : existingQuote.lead_number,
        b.company_name !== undefined ? b.company_name : existingQuote.company_name,
        b.contact_person_name !== undefined ? b.contact_person_name : existingQuote.contact_person_name,
        b.address !== undefined ? b.address : existingQuote.address,
        cover_image_path,
        b.reference_no !== undefined ? b.reference_no : existingQuote.reference_no,
        quotation_date, validity_days, valid_until,
        b.currency || existingQuote.currency, tax_rate, discount_amount,
        b.subject !== undefined ? b.subject : existingQuote.subject,
        b.cover_body !== undefined ? b.cover_body : existingQuote.cover_body,
        b.customer_type !== undefined ? b.customer_type : existingQuote.customer_type,
        b.bill_reference !== undefined ? b.bill_reference : existingQuote.bill_reference,
        b.period !== undefined ? b.period : existingQuote.period,
        b.existing_kwh !== undefined ? b.existing_kwh : existingQuote.existing_kwh,
        b.existing_kvah !== undefined ? b.existing_kvah : existingQuote.existing_kvah,
        b.effective_pf !== undefined ? b.effective_pf : existingQuote.effective_pf,
        b.per_unit_rate !== undefined ? b.per_unit_rate : existingQuote.per_unit_rate,
        b.per_unit_rate_with_taxes !== undefined ? b.per_unit_rate_with_taxes : existingQuote.per_unit_rate_with_taxes,
        b.demand_rate !== undefined ? b.demand_rate : existingQuote.demand_rate,
        b.existing_kva_demand !== undefined ? b.existing_kva_demand : existingQuote.existing_kva_demand,
        b.existing_kw_demand !== undefined ? b.existing_kw_demand : existingQuote.existing_kw_demand,
        b.grand_total !== undefined ? b.grand_total : existingQuote.grand_total,
        subtotal, tax_amount, total_amount,
        b.quotation_status ? b.quotation_status.toLowerCase() : existingQuote.quotation_status,
        id // The WHERE clause ID
      ]
    );

    // ✅ 6. Sync Items: Delete all old items, then insert the new updated list
    await conn.query(`DELETE FROM quotation_items WHERE quotation_id = ?`, [id]);

    for (const it of items) {
      await conn.query(
        `INSERT INTO quotation_items (quotation_id, position, particulars, qty, rate, amount)
         VALUES (?,?,?,?,?,?)`,
        [id, it.position, it.particulars, it.qty, it.rate, it.amount]
      );
    }

    // ✅ 7. Optional: Log activity if lead_number is attached
    if (b.lead_number) {
      await conn.query(
        `INSERT INTO lead_activity_backup
         (lead_id, changed_by, changed_by_department, changed_by_role, change_type, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          b.lead_number,
          user.employee_id,
          user.department_id,
          user.role_id,
          "quotation_updated",
          `Quotation ${id} was updated.`
        ]
      );
    }

    await conn.commit();

    // ✅ 8. Fetch and return the freshly updated quotation
    const [[updatedQ]] = await pool.query(`SELECT * FROM quotations WHERE quotation_id = ?`, [id]);
    const [updatedLines] = await pool.query(
      `SELECT item_id, position, particulars, qty, rate, amount
       FROM quotation_items WHERE quotation_id = ? ORDER BY position ASC, item_id ASC`,
      [id]
    );

    return res.status(200).json({
      message: "Quotation updated successfully",
      data: { ...updatedQ, items: updatedLines },
    });
  } catch (err) {
    await conn.query("ROLLBACK");
    console.error("Update quotation error:", err);
    return res.status(500).json({ message: "Failed to update quotation" });
  } finally {
    conn.release();
  }
};