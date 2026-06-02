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
      reason, 
      expense_date, 
      expense_time, 
      amount, 
      associated_employees 
    } = req.body;
    
    // Securely getting the logged-in user's ID
    const employeeId = req.user.employee_id; 
    const createdBy = req.user.employee_id; 

    // --- UPDATED ROLE CHECK ---
    // Safely extract the role, checking 'auth_role' first to match your JWT setup
    const userRole = String(req.user.auth_role || req.user.role_name || req.user.role_id || req.user.role || "").toLowerCase();
    
    // Explicitly allow if the role is 'reimbursement-head' OR contains 'admin'
    const isAuthorizedApprover = userRole === "reimbursement-head" || userRole.includes("admin") || userRole.includes("head");
    
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

    // --- FIXED SECURITY CHECK ---
    // Block if: Not the trip owner AND Not a Reimbursement-Head/Admin
    if (trip.employee_id !== employeeId && !isAuthorizedApprover) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to add expenses to this trip." });
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



/* -------------------------------------------------------------------------- */
/* ADMIN: GET ALL REIMBURSEMENTS WITH EXPENSES                                */
/* -------------------------------------------------------------------------- */
export const getAllReimbursementsForAdmin = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // 1. Security Check: Restrict to Reimbursement-Head (and IpqsHead if you want super-admin access)
    const allowedRoles = ["Reimbursement-Head", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only the Reimbursement Head can access all records.",
      });
    }

    // 2. Fetch everything in one highly efficient JOIN query
    const [rows] = await pool.query(
      `SELECT 
        r.reimbursement_id, 
        r.employee_id, 
        r.company_name, 
        DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date, 
        DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date, 
        r.res_status, 
        r.created_at AS trip_created_at,
        
        -- Employee Details (Who submitted it)
        emp.first_name, 
        emp.last_name,
        emp.department_id, -- ✅ Added department here
        
        -- Expense Details
        e.expense_id, 
        e.description, 
        e.reason, 
        e.amount, 
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date, 
        e.expense_time, 
        e.receipt_path, 
        e.associated_employees
       FROM reimbursements r
       LEFT JOIN employees emp ON r.employee_id = emp.employee_id
       LEFT JOIN reimbursement_expenses e ON r.reimbursement_id = e.reimbursement_id
       ORDER BY r.created_at DESC, e.expense_date DESC`
    );

    // 3. Group the flat SQL rows into beautifully structured JSON
    const reimbursementsMap = {};

    for (const row of rows) {
      // If we haven't seen this trip yet, create its folder
      if (!reimbursementsMap[row.reimbursement_id]) {
        reimbursementsMap[row.reimbursement_id] = {
          reimbursement_id: row.reimbursement_id,
          employee_id: row.employee_id,
          employee_name: (row.first_name && row.last_name) 
            ? `${row.first_name} ${row.last_name}` 
            : row.employee_id,
          department_name: row.department_id, // ✅ Added right below employee name
          company_name: row.company_name,
          start_date: row.start_date,
          end_date: row.end_date,
          status: row.res_status,
          submitted_on: row.trip_created_at,
          total_trip_cost: 0, // We will calculate this automatically!
          expenses: []
        };
      }

      // If this trip has an expense attached, push it into the array
      if (row.expense_id) {
        // Safely parse the associated_employees JSON array
        let parsedEmployees = [];
        if (row.associated_employees) {
          try {
            parsedEmployees = typeof row.associated_employees === 'string' 
              ? JSON.parse(row.associated_employees) 
              : row.associated_employees;
          } catch (err) {
             parsedEmployees = [];
          }
        }

        const expenseAmount = parseFloat(row.amount);

        reimbursementsMap[row.reimbursement_id].expenses.push({
          expense_id: row.expense_id,
          description: row.description,
          reason: row.reason,
          amount: expenseAmount,
          expense_date: row.expense_date,
          expense_time: row.expense_time,
          receipt_path: row.receipt_path,
          associated_employees: parsedEmployees
        });

        // Automatically add to the trip's grand total
        reimbursementsMap[row.reimbursement_id].total_trip_cost += expenseAmount;
      }
    }

    // Convert our mapped object back into a clean array
    const finalData = Object.values(reimbursementsMap);

    // 4. Return Success
    return res.status(200).json({
      message: "Admin reimbursement data fetched successfully.",
      total_trips: finalData.length,
      data: finalData
    });

  } catch (error) {
    console.error("Error fetching admin reimbursements:", error);
    res.status(500).json({ error: "Server error while fetching reimbursements." });
  }
};



/* -------------------------------------------------------------------------- */
/* GET SINGLE REIMBURSEMENT DETAILS WITH ALL EXPENSES                         */
/* -------------------------------------------------------------------------- */
export const getReimbursementDetails = async (req, res) => {
  try {
    const { id: reimbursement_id } = req.params;
    const { employee_id, role_id } = req.user;

    // 1. Fetch the data using a LEFT JOIN to get the trip and its expenses
    const [rows] = await pool.query(
      `SELECT 
        r.reimbursement_id, 
        r.employee_id, 
        r.company_name, 
        DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date, 
        DATE_FORMAT(r.end_date, '%Y-%m-%d') AS end_date, 
        r.res_status, 
        r.created_at AS trip_created_at,
        
        emp.first_name, 
        emp.last_name,
        
        e.expense_id, 
        e.description, 
        e.reason, 
        e.amount, 
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date, 
        e.expense_time, 
        e.receipt_path, 
        e.associated_employees
       FROM reimbursements r
       LEFT JOIN employees emp ON r.employee_id = emp.employee_id
       LEFT JOIN reimbursement_expenses e ON r.reimbursement_id = e.reimbursement_id
       WHERE r.reimbursement_id = ?
       ORDER BY e.expense_date ASC, e.expense_time ASC`,
      [reimbursement_id]
    );

    // 2. Check if the trip actually exists
    if (rows.length === 0) {
      return res.status(404).json({ error: "Reimbursement trip not found." });
    }

    // 3. Security Check: Only Admins OR the trip owner can view this
    const allowedAdmins = ["Reimbursement-Head", "IpqsHead"];
    const isAdmin = allowedAdmins.includes(role_id);
    const isOwner = rows[0].employee_id === employee_id;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ 
        error: "Forbidden: You do not have permission to view this reimbursement." 
      });
    }

    // 4. Format the Data neatly
    const tripDetails = {
      reimbursement_id: rows[0].reimbursement_id,
      employee_id: rows[0].employee_id,
      employee_name: (rows[0].first_name && rows[0].last_name) 
        ? `${rows[0].first_name} ${rows[0].last_name}` 
        : rows[0].employee_id,
      company_name: rows[0].company_name,
      start_date: rows[0].start_date,
      end_date: rows[0].end_date,
      status: rows[0].res_status,
      submitted_on: rows[0].trip_created_at,
      total_trip_cost: 0,
      expenses: []
    };

    // 5. Loop through the rows to attach the expenses
    for (const row of rows) {
      if (row.expense_id) {
        
        // Parse the JSON array safely
        let parsedEmployees = [];
        if (row.associated_employees) {
          try {
            parsedEmployees = typeof row.associated_employees === 'string' 
              ? JSON.parse(row.associated_employees) 
              : row.associated_employees;
          } catch (err) {
            parsedEmployees = [];
          }
        }

        const expenseAmount = parseFloat(row.amount);

        tripDetails.expenses.push({
          expense_id: row.expense_id,
          description: row.description,
          reason: row.reason,
          amount: expenseAmount,
          expense_date: row.expense_date,
          expense_time: row.expense_time,
          receipt_path: row.receipt_path,
          associated_employees: parsedEmployees
        });

        // Automatically tally up the grand total
        tripDetails.total_trip_cost += expenseAmount;
      }
    }

    // 6. Return Success
    return res.status(200).json({
      message: "Reimbursement details fetched successfully.",
      data: tripDetails
    });

  } catch (error) {
    console.error("Error fetching reimbursement details:", error);
    res.status(500).json({ error: "Server error while fetching details." });
  }
};


/* -------------------------------------------------------------------------- */
/* ADMIN: PROCESS (APPROVE/REJECT) REIMBURSEMENT EXPENSES                     */
/* -------------------------------------------------------------------------- */
export const processReimbursementExpenses = async (req, res) => {
  let connection;
  
  try {
    // Get connection safely
    connection = await pool.getConnection();
    
    const roleId = req.user.role_id;
    const { reimbursement_id, expenses, final_trip_status } = req.body;

    // 1. Security Check
    const allowedRoles = ["Reimbursement-Head", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      connection.release();
      return res.status(403).json({ error: "Forbidden: Only authorized Heads can process reimbursements." });
    }

    // 2. Validation
    if (!reimbursement_id) {
      connection.release();
      return res.status(400).json({ error: "reimbursement_id is required." });
    }
    
    if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
      connection.release();
      return res.status(400).json({ error: "An array of 'expenses' is required." });
    }

    // 3. Start Transaction
    await connection.beginTransaction();

    // 4. Update each expense item
    for (let i = 0; i < expenses.length; i++) {
      const item = expenses[i];
      const { expense_id, approved_amount, expense_status, admin_comments } = item;

      // Ensure required fields exist in the payload
      if (!expense_id || !expense_status) {
        throw new Error(`Expense item at index ${i} is missing 'expense_id' or 'expense_status'.`);
      }

      await connection.query(
        `UPDATE reimbursement_expenses 
         SET approved_amount = ?, 
             expense_status = ?, 
             admin_comments = ?, 
             updated_at = NOW() 
         WHERE expense_id = ? AND reimbursement_id = ?`,
        [
          approved_amount || 0, 
          expense_status,       
          admin_comments || null, 
          expense_id, 
          reimbursement_id
        ]
      );
    }

    // 5. Update the Parent Trip Status (Only if provided)
    if (final_trip_status) {
      await connection.query(
        `UPDATE reimbursements 
         SET res_status = ?, updated_at = NOW() 
         WHERE reimbursement_id = ?`,
        [final_trip_status, reimbursement_id]
      );
    }

    // 6. Commit the transaction
    await connection.commit();
    connection.release();

    return res.status(200).json({
      message: `Successfully processed ${expenses.length} expenses for trip ${reimbursement_id}.`,
      reimbursement_id,
      final_trip_status: final_trip_status || "Unchanged"
    });

  } catch (error) {
    // 💥 If it fails, rollback and send the EXACT error to the screen!
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    
    console.error("💥 Error processing expenses:", error);
    
    // This will print the exact SQL error directly in your Postman response!
    return res.status(500).json({ 
      error: "Server failed to process the request.", 
      developer_details: error.message,
      sql_error: error.sqlMessage || "No database error provided."
    });
  }
};


/* -------------------------------------------------------------------------- */
/* ADMIN: DELETE REIMBURSEMENT TRIP AND ALL ITS EXPENSES                      */
/* -------------------------------------------------------------------------- */
export const deleteReimbursement = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id: reimbursement_id } = req.params;
    const roleId = req.user.role_id;

    // 1. Security Check: Only Heads can delete
    const allowedRoles = ["Reimbursement-Head", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ error: "Forbidden: Only authorized Heads can delete records." });
    }

    // 2. Start Transaction
    await connection.beginTransaction();

    // 3. Delete all associated expenses first (Foreign Key protection)
    await connection.query(
      `DELETE FROM reimbursement_expenses WHERE reimbursement_id = ?`,
      [reimbursement_id]
    );

    // 4. Delete the parent reimbursement trip
    const [result] = await connection.query(
      `DELETE FROM reimbursements WHERE reimbursement_id = ?`,
      [reimbursement_id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Reimbursement trip not found." });
    }

    // 5. Commit
    await connection.commit();

    return res.status(200).json({ 
      message: `Trip ${reimbursement_id} and all related expenses successfully deleted.` 
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error deleting reimbursement:", error);
    res.status(500).json({ error: "Server error while deleting reimbursement." });
  } finally {
    connection.release();
  }
};