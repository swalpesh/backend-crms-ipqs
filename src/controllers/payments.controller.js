// src/controllers/payments.controller.js
import { pool } from "../config/db.js";
import { validationResult } from "express-validator";
import { nextId } from "../utils/id.generator.js";

// Normalize type strings
function normalizeType(t) {
  const s = String(t || "").toLowerCase().trim();
  if (s === "full payment" || s === "full" || s === "full_payment") return "full";
  if (s === "partial" || s === "partial payment" || s === "part") return "partial";
  return s;
}

// Resolve quotation and ensure stage 'payments'


async function getEmployeeName(conn, employeeId) {
  const [[emp]] = await conn.query(
    `SELECT first_name, last_name FROM employees WHERE employee_id = ?`,
    [employeeId]
  );
  if (!emp) return String(employeeId);
  const fn = String(emp.first_name || "").trim();
  const ln = String(emp.last_name || "").trim();
  return `${fn} ${ln}`.trim() || String(employeeId);
}

function mapRow(r) {
  return {
    payment_id: r.payment_id,
    quotation_id: r.quotation_id,
    quotation_no: r.quotation_no,
    payment_type: r.payment_type,
    payment_date: r.payment_date,
    payment_time: r.payment_time,
    amount: Number(r.amount),
    remarks: r.remarks,

    invoice_status: r.invoice_status,
    invoice_generated_at: r.invoice_generated_at,
    invoice_generated_by: r.invoice_generated_by,
    invoice_generated_by_name: r.invoice_generated_by_name,

    created_at: r.created_at,
    created_by: r.created_by,
    created_by_name: r.created_by_name,
    department_id: r.department_id,
    department_name: r.department_name,

    remaining_amount: r.remaining_amount !== undefined ? Number(r.remaining_amount) : undefined
  };
}

/**
 * POST /api/v1/payments
 */
/**
 * POST /api/v1/payments
 * Simplified version — directly inserts payment without quotation validation.
 */
export const createPayment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    quotation_id,
    quotation_no,
    payment_type,
    payment_date,
    payment_time,
    amount,
    remarks
  } = req.body;

  const employee = req.user;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Generate unique payment ID
    const payment_id = await nextId(conn, "payment", "ipqs-pay-", 3);

    // Get creator's display name
    const creatorName = await getEmployeeName(conn, employee.employee_id);

    // Directly insert into payments table
    await conn.query(
      `INSERT INTO payments
       (payment_id, quotation_id, quotation_no, payment_type, payment_date, payment_time, amount, remarks,
        invoice_status, department_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_generated', ?, ?)`,
      [
        payment_id,
        quotation_id,
        quotation_no,
        payment_type || null,
        payment_date || new Date(),
        payment_time || null,
        amount || 0,
        remarks || null,
        employee.department_id || null,
        employee.employee_id
      ]
    );

    await conn.commit();

    return res.status(201).json({
      message: "Payment created successfully",
      data: {
        payment_id,
        quotation_id,
        quotation_no,
        payment_type: payment_type || null,
        payment_date: payment_date || new Date(),
        payment_time: payment_time || null,
        amount: Number(amount) || 0,
        remarks: remarks || null,
        invoice_status: "not_generated",
        created_by: employee.employee_id,
        created_by_name: creatorName,
        created_at: new Date().toISOString()
      }
    });
  } catch (e) {
    await conn.query("ROLLBACK");
    console.error("Create payment error:", e);
    return res.status(500).json({ message: "Failed to create payment" });
  } finally {
    conn.release();
  }
};


/**
 * GET /api/v1/payments
 */
export const listPayments = async (req, res) => {
  const { quotation_id, quotation_no } = req.query;
  try {
    const where = [];
    const args = [];
    if (quotation_id) { where.push("p.quotation_id = ?"); args.push(quotation_id.trim()); }
    if (quotation_no) { where.push("p.quotation_no = ?"); args.push(quotation_no.trim()); }

    let sql =
      `SELECT p.*,
              q.total_amount,
              d.department_name,
              CONCAT(e.first_name, ' ', e.last_name) AS created_by_name
       FROM payments p
       JOIN quotations q ON q.quotation_id = p.quotation_id
       JOIN departments d ON d.department_id = p.department_id
       JOIN employees e ON e.employee_id = p.created_by`;
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY p.quotation_id ASC, p.created_at ASC, p.payment_id ASC";

    const [rows] = await pool.query(sql, args);

    const out = [];
    const running = {};
    for (const r of rows) {
      const qid = r.quotation_id;
      if (!running[qid]) running[qid] = { total: Number(r.total_amount), paid: 0 };
      running[qid].paid += Number(r.amount);
      const remaining = +((running[qid].total - running[qid].paid)).toFixed(2);

      out.push(mapRow({ ...r, remaining_amount: remaining }));
    }

    return res.json({ data: out });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/v1/payments/:id
 */
export const getPayment = async (req, res) => {
  const id = (req.params.id || "").trim();
  try {
    const [[p]] = await pool.query(
      `SELECT p.*,
              q.total_amount,
              d.department_name,
              CONCAT(e.first_name, ' ', e.last_name) AS created_by_name
       FROM payments p
       JOIN quotations q ON q.quotation_id = p.quotation_id
       JOIN departments d ON d.department_id = p.department_id
       JOIN employees e ON e.employee_id = p.created_by
       WHERE p.payment_id = ?`,
      [id]
    );
    if (!p) return res.status(404).json({ message: "Not found" });

    const [[sumRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS paid
       FROM payments
       WHERE quotation_id = ? AND (created_at < ? OR (created_at = ? AND payment_id <= ?))`,
      [p.quotation_id, p.created_at, p.created_at, p.payment_id]
    );
    const paidToHere = Number(sumRow.paid || 0);
    const remaining = +((Number(p.total_amount) - paidToHere)).toFixed(2);

    return res.json({ data: mapRow({ ...p, remaining_amount: remaining }) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};



export const generateInvoice = async (req, res) => {
  try {
    const paymentId = (req.params.id || "").trim();
    const employee = req.user;

    if (!paymentId) {
      return res.status(400).json({ message: "Payment ID is required" });
    }

    // Get employee name helper (optional)
    const [[emp]] = await pool.query(
      "SELECT first_name, last_name FROM employees WHERE employee_id = ?",
      [employee.employee_id]
    );
    const genByName = emp
      ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim()
      : employee.employee_id;

    // ✅ Direct update — no validation or rollback
    await pool.query(
      `UPDATE payments
       SET invoice_status = 'generated',
           invoice_generated_at = CURRENT_TIMESTAMP,
           invoice_generated_by = ?,
           invoice_generated_by_name = ?
       WHERE payment_id = ?`,
      [employee.employee_id, genByName, paymentId]
    );

    // ✅ Fetch updated payment info to return
    const [[updated]] = await pool.query(
      `SELECT 
          p.payment_id,
          p.quotation_id,
          p.quotation_no,
          p.amount,
          p.payment_type,
          p.invoice_status,
          p.invoice_generated_at,
          p.invoice_generated_by,
          p.invoice_generated_by_name,
          p.department_id,
          p.created_by,
          p.created_at,
          p.updated_at
       FROM payments p
       WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!updated) {
      return res.status(404).json({ message: "Payment not found" });
    }

    return res.status(200).json({
      message: "Invoice successfully marked as generated",
      data: updated,
    });
  } catch (err) {
    console.error("Error generating invoice:", err);
    return res
      .status(500)
      .json({ message: "Server error while generating invoice" });
  }
};



/**
 * GET /api/v1/payments/all
 * Fetch all payments with grand_total and cumulative remaining balance per quotation.
 * Shows latest payment first (descending order by created_at).
 */
export const getAllPaymentDetails = async (req, res) => {
  try {
    // Fetch payments sorted oldest → newest (for correct cumulative calculation)
    const [rows] = await pool.query(`
      SELECT
        p.payment_id,
        p.quotation_id,
        p.quotation_no,
        p.payment_type,
        p.payment_date,
        p.payment_time,
        p.amount,
        p.remarks,
        p.invoice_status,
        p.invoice_generated_at,
        p.invoice_generated_by,
        p.invoice_generated_by_name,
        p.department_id,
        p.created_by,
        p.created_at,
        p.updated_at,
        q.grand_total
      FROM payments p
      LEFT JOIN quotations q
        ON p.quotation_id COLLATE utf8mb4_unicode_ci = q.quotation_id COLLATE utf8mb4_unicode_ci
      ORDER BY p.quotation_id ASC, p.created_at ASC
    `);

    if (!rows.length) {
      return res.status(200).json({
        message: "No payment records found",
        total: 0,
        payments: [],
      });
    }

    // 🧮 Compute cumulative remaining balance per quotation
    const balanceMap = {}; // { quotation_id: remainingBalance }
    const calculated = rows.map((p) => {
      const qid = p.quotation_id;
      if (!balanceMap[qid]) balanceMap[qid] = Number(p.grand_total || 0);

      // Subtract this payment
      const remaining = +(balanceMap[qid] - Number(p.amount || 0)).toFixed(2);

      // Update for next record
      balanceMap[qid] = remaining;

      return {
        ...p,
        remaining_balance: remaining < 0 ? 0 : remaining, // prevent negatives
      };
    });

    // 🔄 Sort to show latest payments first (newest → oldest)
    const payments = calculated.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    return res.status(200).json({
      message:
        "Payments with cumulative remaining balance fetched successfully (latest first)",
      total: payments.length,
      payments,
    });
  } catch (err) {
    console.error("Error fetching payments with cumulative balance:", err);
    return res
      .status(500)
      .json({ message: "Server error while fetching payments" });
  }
};





