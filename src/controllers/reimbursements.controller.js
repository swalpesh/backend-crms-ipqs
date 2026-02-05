import { pool } from "../config/db.js";

/* ---------------- Helper: Generate Custom ID ---------------- */
function generateReimbursementId() {
  const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
  return `RE_IPQS_${randomNum}`;
}

/* ---------------- Create Reimbursement ---------------- */
export const createReimbursement = async (req, res) => {
  try {
    const {
      lead_id,
      company_name,
      category,
      date,
      time,
      location,
      amount
    } = req.body;

    const created_by = req.user.employee_id;
    const file_path = req.file ? req.file.path : null; // Handles single file upload

    // ✅ Validation
    if (!company_name || !category || !amount || !date) {
      return res.status(400).json({ 
        error: "Company name, category, date, and amount are required." 
      });
    }

    // ✅ Generate Unique ID
    let reimbursement_id = generateReimbursementId();
    
    // Safety check: ensure ID doesn't exist (extremely rare collision check)
    let [existing] = await pool.query("SELECT 1 FROM reimbursements WHERE reimbursement_id = ?", [reimbursement_id]);
    while (existing.length > 0) {
      reimbursement_id = generateReimbursementId();
      [existing] = await pool.query("SELECT 1 FROM reimbursements WHERE reimbursement_id = ?", [reimbursement_id]);
    }

    // ✅ Insert into Database
    await pool.query(
      `INSERT INTO reimbursements 
      (reimbursement_id, lead_id, company_name, category, expense_date, expense_time, location, amount, file_path, created_by, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())`,
      [
        reimbursement_id,
        lead_id || null, // lead_id is optional
        company_name,
        category,
        date,
        time || "00:00:00",
        location || "Not Provided",
        amount,
        file_path,
        created_by
      ]
    );

    res.status(201).json({
      message: "Reimbursement request submitted successfully.",
      reimbursement_id,
      status: "Pending",
      amount,
      file_path
    });

  } catch (error) {
    console.error("Error creating reimbursement:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Personal Reimbursements (Everyone) ---------------- */
export const getReimbursements = async (req, res) => {
  try {
    const userId = req.user.employee_id;

    // ✅ Query: Select reimbursements WHERE created_by = logged_in_user
    // We still join with employees just to format the name nicely in the response
    const query = `
      SELECT 
        r.*,
        e.first_name, 
        e.last_name, 
        e.username
      FROM reimbursements r
      LEFT JOIN employees e 
        ON r.created_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE r.created_by = ?
      ORDER BY r.created_at DESC
    `;

    const [rows] = await pool.query(query, [userId]);

    // ✅ Process Data
    const results = rows.map(row => {
      const formatted = {
        ...row,
        requested_by_name: (row.first_name && row.last_name) 
          ? `${row.first_name} ${row.last_name}` 
          : row.username
      };
      
      // Cleanup raw fields
      delete formatted.first_name;
      delete formatted.last_name;
      delete formatted.username;
      
      return formatted;
    });

    res.status(200).json({
      message: "Personal reimbursements fetched successfully",
      total: results.length,
      data: results
    });

  } catch (error) {
    console.error("Error fetching reimbursements:", error);
    res.status(500).json({ error: "Server error" });
  }
};


/* ---------------- Get Reimbursements By Employee ID (Grouped by Company) ---------------- */
export const getReimbursementsByEmployeeId = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const requesterRoleId = req.user.role_id;
    const requesterId = req.user.employee_id;

    // ✅ Security Check
    const allowedHeads = ["IpqsHead", "Technical-Team-Head", "Associate-Marketing-Head"];
    if (!allowedHeads.includes(requesterRoleId) && employeeId !== requesterId) {
      return res.status(403).json({ 
        error: "Forbidden: You are not authorized to view this employee's expenses." 
      });
    }

    // ✅ Query: Fetch flat list first
    const query = `
      SELECT 
        r.*,
        e.first_name, 
        e.last_name, 
        e.username
      FROM reimbursements r
      LEFT JOIN employees e 
        ON r.created_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE r.created_by = ?
      ORDER BY r.expense_date DESC, r.expense_time DESC
    `;

    const [rows] = await pool.query(query, [employeeId]);

    // ✅ Grouping Logic
    // We create an object where keys are Company Names
    const groupedData = {};

    rows.forEach((row) => {
      // 1. Format the requested_by name
      const employeeName = (row.first_name && row.last_name) 
          ? `${row.first_name} ${row.last_name}` 
          : row.username;

      // 2. Create the clean expense object
      const expenseItem = {
        reimbursement_id: row.reimbursement_id,
        lead_id: row.lead_id,
        category: row.category,
        date: row.expense_date,
        time: row.expense_time,
        location: row.location,
        amount: row.amount,
        status: row.status,
        file_path: row.file_path,
        created_at: row.created_at
      };

      // 3. Initialize the group if it doesn't exist yet
      if (!groupedData[row.company_name]) {
        groupedData[row.company_name] = {
          company_name: row.company_name,
          employee_id: row.created_by,
          employee_name: employeeName,
          total_claimed_amount: 0,
          total_entries: 0,
          expenses: [] // The array you requested
        };
      }

      // 4. Add data to the group
      groupedData[row.company_name].expenses.push(expenseItem);
      groupedData[row.company_name].total_entries += 1;
      groupedData[row.company_name].total_claimed_amount += Number(row.amount);
    });

    // ✅ Convert object back to array for the JSON response
    const finalResult = Object.values(groupedData);

    res.status(200).json({
      message: `Reimbursements for employee ${employeeId} fetched successfully`,
      unique_companies_visited: finalResult.length,
      data: finalResult
    });

  } catch (error) {
    console.error("Error fetching employee reimbursements:", error);
    res.status(500).json({ error: "Server error" });
  }
};