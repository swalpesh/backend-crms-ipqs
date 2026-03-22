import { pool } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* CREATE REIMBURSEMENT                                                       */
/* -------------------------------------------------------------------------- */
export const createReimbursement = async (req, res) => {
  try {
    const { company_name, start_date, end_date } = req.body;
    const employeeId = req.user.employee_id; 

    // 1. Basic Validation (end_date is no longer compulsory)
    if (!company_name || !start_date) {
      return res.status(400).json({ 
        error: "company_name and start_date are required." 
      });
    }

    // 2. Generate Custom ID (RES_IPQS_ + 4 random digits)
    const randomDigits = Math.floor(1000 + Math.random() * 9000); // Generates 1000 to 9999
    const reimbursement_id = `RES_IPQS_${randomDigits}`;

    // 3. Insert into Database (fallback to null if end_date is missing)
    await pool.query(
      `INSERT INTO reimbursements 
       (reimbursement_id, employee_id, company_name, start_date, end_date) 
       VALUES (?, ?, ?, ?, ?)`,
      [reimbursement_id, employeeId, company_name, start_date, end_date || null]
    );

    // 4. Return Success
    return res.status(201).json({
      message: "Reimbursement created successfully.",
      data: {
        reimbursement_id,
        employee_id: employeeId,
        company_name,
        start_date,
        end_date: end_date || null
      }
    });

  } catch (error) {
    console.error("Error creating reimbursement:", error);
    res.status(500).json({ error: "Server error while creating reimbursement." });
  }
};

/* -------------------------------------------------------------------------- */
/* UPDATE REIMBURSEMENT (Only by the owning employee)                         */
/* -------------------------------------------------------------------------- */
export const updateReimbursement = async (req, res) => {
  try {
    const { id } = req.params; // The reimbursement_id from the URL
    const { company_name, start_date, end_date } = req.body;
    const employeeId = req.user.employee_id;

    // 1. Fetch existing record to ensure it exists and belongs to the user
    const [[existingRecord]] = await pool.query(
      `SELECT * FROM reimbursements WHERE reimbursement_id = ?`,
      [id]
    );

    if (!existingRecord) {
      return res.status(404).json({ error: "Reimbursement not found." });
    }

    if (existingRecord.employee_id !== employeeId) {
      return res.status(403).json({ 
        error: "Forbidden: You can only update your own reimbursements." 
      });
    }

    // 2. Execute Update (Fallback to existing data if a field isn't provided)
    await pool.query(
      `UPDATE reimbursements 
       SET company_name = ?, 
           start_date = ?, 
           end_date = ?, 
           updated_at = NOW() 
       WHERE reimbursement_id = ? AND employee_id = ?`,
      [
        company_name || existingRecord.company_name,
        start_date || existingRecord.start_date,
        end_date || existingRecord.end_date,
        id,
        employeeId // Double-checking ownership in the WHERE clause
      ]
    );

    // 3. Return Success
    return res.status(200).json({
      message: `Reimbursement ${id} updated successfully.`,
      data: {
        reimbursement_id: id,
        company_name: company_name || existingRecord.company_name,
        start_date: start_date || existingRecord.start_date,
        end_date: end_date || existingRecord.end_date
      }
    });

  } catch (error) {
    console.error("Error updating reimbursement:", error);
    res.status(500).json({ error: "Server error while updating reimbursement." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET MY REIMBURSEMENTS (Logged-in employee only)                            */
/* -------------------------------------------------------------------------- */
export const getMyReimbursements = async (req, res) => {
  try {
    // 1. Extract the employee ID from the verified token
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(401).json({ error: "Unauthorized: Missing employee token." });
    }

    // 2. Fetch ONLY the records belonging to this specific employee
    // ✅ FIX: Use DATE_FORMAT to return the exact date string stored in the DB
    const [reimbursements] = await pool.query(
      `SELECT 
        reimbursement_id, 
        company_name, 
        DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, 
        DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, 
        res_status,
        created_at,
        updated_at
       FROM reimbursements 
       WHERE employee_id = ? 
       ORDER BY created_at DESC`,
      [employeeId]
    );

    // 3. Return the data
    return res.status(200).json({
      message: "Reimbursements fetched successfully.",
      total: reimbursements.length,
      data: reimbursements
    });

  } catch (error) {
    console.error("Error fetching my reimbursements:", error);
    res.status(500).json({ error: "Server error while fetching reimbursements." });
  }
};


/* -------------------------------------------------------------------------- */
/* ADD REIMBURSEMENT EXPENSE (With Multi-Employee Select & Reason)            */
/* -------------------------------------------------------------------------- */
export const addReimbursementExpense = async (req, res) => {
  try {
    const { 
      reimbursement_id, 
      description,
      reason, // <-- The reason field we added
      expense_date, 
      expense_time, 
      amount, 
      associated_employees 
    } = req.body;
    
    // Securely getting the logged-in user
    const employeeId = req.user.employee_id; 
    const createdBy = req.user.employee_id; 
    
    // Grab the uploaded file path (Multer handles the 'file' key from the route)
    const receiptPath = req.file ? req.file.path : null;

    // 1. Basic Validation
    if (!reimbursement_id || !description || !expense_date || !expense_time || !amount) {
      return res.status(400).json({ 
        error: "reimbursement_id, description, expense_date, expense_time, and amount are required." 
      });
    }

    // 2. Parse the associated_employees array from multipart/form-data
    let parsedEmployees = [];
    if (associated_employees) {
      try {
        parsedEmployees = JSON.parse(associated_employees);
      } catch (e) {
        if (typeof associated_employees === 'string') {
          parsedEmployees = associated_employees.split(',').map(id => id.trim());
        } else if (Array.isArray(associated_employees)) {
          parsedEmployees = associated_employees;
        }
      }
    }
    const employeesJsonString = JSON.stringify(parsedEmployees);

    // 3. Generate Custom Expense ID
    const randomDigits = Math.floor(10000 + Math.random() * 90000); 
    const expense_id = `RES_EXP_${randomDigits}`;

    // 4. Security Check: Verify the reimbursement belongs to this employee
    const [[trip]] = await pool.query(
      `SELECT employee_id FROM reimbursements WHERE reimbursement_id = ?`,
      [reimbursement_id]
    );

    if (!trip) {
      return res.status(404).json({ error: "Reimbursement trip not found." });
    }

    if (trip.employee_id !== employeeId) {
      return res.status(403).json({ error: "Forbidden: You can only add expenses to your own trips." });
    }

    // 5. Insert the Expense into the Database
    await pool.query(
      `INSERT INTO reimbursement_expenses 
       (expense_id, reimbursement_id, employee_id, associated_employees, description, reason, expense_date, expense_time, amount, receipt_path, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_id, 
        reimbursement_id, 
        employeeId, 
        employeesJsonString, 
        description, 
        reason || null, 
        expense_date, 
        expense_time, 
        amount, 
        receiptPath, 
        createdBy
      ]
    );

    // 6. Return Success
    return res.status(201).json({
      message: "Expense added successfully.",
      data: {
        expense_id,
        reimbursement_id,
        associated_employees: parsedEmployees,
        description,
        reason: reason || null,
        expense_date,
        expense_time,
        amount: parseFloat(amount),
        receipt_path: receiptPath,
        created_by: createdBy
      }
    });

  } catch (error) {
    console.error("Error adding expense:", error);
    res.status(500).json({ error: "Server error while adding expense." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET EXPENSES FOR A SPECIFIC REIMBURSEMENT TRIP                             */
/* -------------------------------------------------------------------------- */
export const getReimbursementExpenses = async (req, res) => {
  try {
    const { id: reimbursement_id } = req.params; 
    const employeeId = req.user.employee_id;

    // 1. Fetch expenses, including the newly added 'reason' column
    const [expenses] = await pool.query(
      `SELECT 
        e.expense_id,
        e.reimbursement_id,
        e.associated_employees,
        e.description,
        e.reason, -- <-- Added reason field here
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date,
        e.expense_time,
        e.amount,
        e.receipt_path,
        e.created_by,
        e.created_at
       FROM reimbursement_expenses e
       JOIN reimbursements r ON e.reimbursement_id = r.reimbursement_id
       WHERE e.reimbursement_id = ? AND r.employee_id = ?
       ORDER BY e.expense_date DESC, e.expense_time DESC`,
      [reimbursement_id, employeeId]
    );

    // 2. Parse the associated_employees JSON safely
    const formattedExpenses = expenses.map(exp => ({
      ...exp,
      amount: parseFloat(exp.amount),
      associated_employees: typeof exp.associated_employees === 'string' 
        ? JSON.parse(exp.associated_employees) 
        : exp.associated_employees
    }));

    // 3. Return the data
    return res.status(200).json({
      message: "Expenses fetched successfully.",
      total: formattedExpenses.length,
      data: formattedExpenses
    });

  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: "Server error while fetching expenses." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET REIMBURSEMENT SUMMARY (With Total Expense Amounts)                     */
/* -------------------------------------------------------------------------- */
export const getReimbursementSummary = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;

    // This query selects trip details and sums up the associated expenses
    const [summary] = await pool.query(
      `SELECT 
        r.reimbursement_id, 
        r.company_name, 
        DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date, 
        DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date, 
        r.res_status,
        COALESCE(SUM(e.amount), 0) AS total_expense_amount,
        COUNT(e.expense_id) AS total_bills_uploaded
       FROM reimbursements r
       LEFT JOIN reimbursement_expenses e ON r.reimbursement_id = e.reimbursement_id
       WHERE r.employee_id = ?
       GROUP BY r.reimbursement_id
       ORDER BY r.created_at DESC`,
      [employeeId]
    );

    return res.status(200).json({
      message: "Employee reimbursement summary fetched successfully.",
      employee_id: employeeId,
      total_trips: summary.length,
      data: summary
    });

  } catch (error) {
    console.error("Error fetching reimbursement summary:", error);
    res.status(500).json({ error: "Server error while fetching summary." });
  }
};