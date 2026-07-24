import { pool } from "../config/db.js";
import { validationResult } from "express-validator";

/* ----------------------------- Role Helpers ----------------------------- */
function isIpqsHead(user) {
  return (
    user?.department_id === "IpqsHead" &&
    user?.role_id === "IpqsHead"
  );
}

function isSolutionsHead(user) {
  return (
    user?.department_id === "Solutions-Team" &&
    user?.role_id === "Solutions-Team-Head"
  );
}

function isSolutionsEmployee(user) {
  return (
    user?.department_id === "Solutions-Team" &&
    user?.role_id === "Solutions-Team-Employee"
  );
}

/* --------------------- Auto-generate Lead ID (L-001…) ------------------- */
async function generateLeadId() {
  // Fetch the absolute highest lead_id currently in the database
  const [lastLeadData] = await pool.query(
    `SELECT lead_id 
     FROM leads 
     WHERE lead_id LIKE 'L-%' 
     ORDER BY CAST(SUBSTRING(lead_id, 3) AS UNSIGNED) DESC 
     LIMIT 1`
  );

  let nextNumber = 1;

  if (lastLeadData.length > 0) {
    const lastId = lastLeadData[0].lead_id; // e.g., 'L-184'
    // Extract the number part, parse it to an integer, and add 1
    const lastNumber = parseInt(lastId.split('-')[1], 10);
    nextNumber = lastNumber + 1;
  }

  // Returns L-185 (or pads with zeros for low numbers like L-001)
  return `L-${String(nextNumber).padStart(3, "0")}`;
}

/* -------------------------------- Create -------------------------------- */
export const createLead = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const {
      lead_name,
      company_name,
      contact_person_name,
      contact_person_phone,
      contact_person_email,
      company_contact_number,
      company_email,
      company_website,
      company_address,
      company_country,
      company_state,
      company_city,
      zipcode,
      industry_type,
      lead_requirement,
      notes,
      assigned_employee,
      lead_status,
      follow_up_reason,
      follow_up_date,
      follow_up_time,
      lead_stage,
    } = req.body;

    const lead_id = await generateLeadId();
    const created_by = req.user.employee_id;

    // ✅ Step 1: Insert Lead into main leads table
    await pool.query(
      `INSERT INTO leads 
      (lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
       company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
       industry_type, lead_requirement, notes, status, assigned_employee, created_by, lead_status,
       follow_up_reason, follow_up_date, follow_up_time, lead_stage)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`,
      [
        lead_id,
        lead_name,
        company_name,
        contact_person_name,
        contact_person_phone,
        contact_person_email,
        company_contact_number,
        company_email,
        company_website,
        company_address,
        company_country,
        company_state,
        company_city,
        zipcode,
        industry_type,
        lead_requirement,
        notes,
        assigned_employee || "0",
        created_by,
        lead_status || "new",
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        lead_stage || "Solutions-Team",
      ]
    );

    // ✅ Step 2: Log activity in lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      [lead_id, lead_stage || "Solutions-Team", assigned_employee || "0"]
    );

    // ✅ Step 3: Save attachments (if any)
    if (req.files?.length > 0) {
      for (const file of req.files) {
        await pool.query(
          "INSERT INTO lead_attachments (lead_id, file_name, file_path) VALUES (?,?,?)",
          [lead_id, file.originalname, file.path]
        );
      }
    }

    // ✅ Step 4: Send success response
    return res.status(201).json({
      message: "Lead created successfully",
      lead_id,
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};


/* --------------------------------- List --------------------------------- */
export const listLeads = async (req, res) => {
  try {
    const { lead_status, lead_stage, assigned_employee } = req.query;
    let query = "SELECT * FROM leads WHERE 1=1";
    const params = [];

    if (lead_status) {
      query += " AND lead_status = ?";
      params.push(lead_status);
    }
    if (lead_stage) {
      query += " AND lead_stage = ?";
      params.push(lead_stage);
    }
    if (assigned_employee) {
      query += " AND assigned_employee = ?";
      params.push(assigned_employee);
    }

    const [leads] = await pool.query(query, params);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
      message: "Leads fetched successfully",
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------------------- Update status ----------------------------- */
export const updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params; // lead_id
    const { lead_status, follow_up_reason, follow_up_date, follow_up_time } = req.body;

    console.log("🚀 updateLeadStatus called for Lead:", id);
    console.log("📦 Request Body:", req.body);

    if (!["follow-up", "lost"].includes(lead_status)) {
      console.log("❌ Invalid status");
      return res.status(400).json({ error: "Invalid status. Only follow-up or lost allowed." });
    }

    // ✅ Fetch existing data (correct columns)
    const [prevRows] = await pool.query(
      `SELECT follow_up_reason, follow_up_date, follow_up_time, 
              assigned_employee, lead_stage
       FROM leads WHERE lead_id = ?`,
      [id]
    );

    if (prevRows.length === 0) {
      console.log("❌ Lead not found");
      return res.status(404).json({ error: "Lead not found" });
    }

    const previousData = prevRows[0];
    console.log("🗂 Previous Lead Data:", previousData);

    let params;

    if (lead_status === "follow-up") {
      if (!follow_up_reason || !follow_up_date || !follow_up_time) {
        return res.status(400).json({
          error: "Follow-up requires reason, follow_up_date, and follow_up_time",
        });
      }

      params = [lead_status, follow_up_reason, follow_up_date, follow_up_time, id];

      const backupData = [
        id,
        previousData.follow_up_date || null,
        previousData.follow_up_time || null,
        previousData.follow_up_reason || null,
        previousData.assigned_employee || null, // ✅ correct column
        follow_up_date,
        follow_up_time,
        follow_up_reason,
        previousData.lead_stage || null, // ✅ correct column
      ];

      console.log("🟢 Inserting followup_history with:", backupData);

      try {
        const [insertResult] = await pool.query(
          `INSERT INTO followup_history 
           (lead_id, previous_followup_date, previous_followup_time, previous_followup_reason, 
            updated_by_emp_id, new_followup_date, new_followup_time, new_followup_reason, department_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          backupData
        );
        console.log("✅ Insert success:", insertResult);
      } catch (err) {
        console.error("❌ INSERT ERROR:", err);
      }
    } else {
      // lost case
      params = [lead_status, null, null, null, id];
      console.log("⚪ Lead marked as lost, skipping history insert.");
    }

    // ✅ Update leads table
    const [updateResult] = await pool.query(
      `UPDATE leads 
       SET lead_status = ?, follow_up_reason = ?, follow_up_date = ?, follow_up_time = ?, updated_at = NOW()
       WHERE lead_id = ?`,
      params
    );
    console.log("🟢 Update success:", updateResult);

    return res.status(200).json({ message: `Lead ${id} updated to ${lead_status}` });
  } catch (error) {
    console.error("💥 Fatal controller error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ----------------------- All Solutions Team Leads ---------------------- */
export const listLeadsByEmployee = async (req, res) => {
  try {
    const { lead_status } = req.query;

    // Base query: Remove 'assigned_employee = ?'
    let query = "SELECT * FROM leads WHERE lead_stage = 'Solutions-Team'";
    const params = [];

    // Add status filter if provided
    if (lead_status) {
      if (!["new", "follow-up", "lost"].includes(lead_status)) {
        return res.status(400).json({ error: "Invalid lead_status value" });
      }
      query += " AND lead_status = ?";
      params.push(lead_status);
    }

    // Sort by newest first
    query += " ORDER BY created_at DESC";

    const [leads] = await pool.query(query, params);

    // Fetch attachments for all leads found
    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    res.status(200).json({
      message: "All Solutions-Team leads fetched successfully",
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching all solutions leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ------------------------ Today’s follow-ups (self) --------------------- */
export const listTodaysFollowUps = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;

    const [leads] = await pool.query(
      `SELECT * FROM leads 
       WHERE (created_by = ? OR assigned_employee = ?)
       AND lead_status = 'follow-up' 
       AND lead_stage = 'Solutions-Team'
       AND follow_up_date = CURDATE()
       ORDER BY follow_up_time ASC`,
      [employeeId, employeeId]
    );

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    res.status(200).json({
      message: "Today's follow-ups fetched successfully",
      employee: employeeId,
      date: new Date().toISOString().split("T")[0],
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching today's follow-ups:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ------------- Associate-Marketing employees & leads (Head / IpqsHead) -- */
export const SolutionsTeamAllLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Associate-Marketing-Head or IpqsHead
    if (!["Solutions-Team-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Solutions-Team Head or IpqsHead can access this.",
      });
    }

    // ✅ Handle both correct and misspelled department values
    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id IN ('Solutions-Team', 'Solutions-Team')"
    );

    const data = { employees: [], unassigned_leads: [] };

    for (const emp of employees) {
      const [leads] = await pool.query(
        "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Solutions-Team' ORDER BY created_at DESC",
        [emp.employee_id]
      );

      for (const lead of leads) {
        const [attachments] = await pool.query(
          "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
          [lead.lead_id]
        );
        lead.attachments = attachments;
      }

      data.employees.push({ ...emp, total_leads: leads.length, leads });
    }

    const [unassigned] = await pool.query(
      "SELECT * FROM leads WHERE assigned_employee = '0' AND lead_stage = 'Solutions-Team' ORDER BY created_at DESC"
    );

    for (const lead of unassigned) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    data.unassigned_leads = unassigned;

    res.status(200).json({
      message: "Solutions-Team employees and their leads fetched successfully",
      accessed_by: roleId,
      department: "Solutions-Team",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Solutions-Team leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};



/* --------------------------- Change lead stage --------------------------- */
export const changeLeadStageByIpqsHead = async (req, res) => {
  try {
    const { lead_id, new_lead_stage, reason } = req.body;
    const userId = req.user.employee_id;
    const departmentId = req.user.department_id;
    const roleId = req.user.role_id;

    const allowedRoles = [
      "IpqsHead",
      "Solutions-Team-Head",
      "Solutions-Team-Employee",
    ];

    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not allowed to change lead stage.",
      });
    }

    if (!lead_id || !new_lead_stage) {
      return res
        .status(400)
        .json({ error: "lead_id and new_lead_stage are required." });
    }

    const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [
      lead_id,
    ]);
    if (leadData.length === 0)
      return res.status(404).json({ error: "Lead not found." });

    const oldLead = leadData[0];

    await pool.query(
      `UPDATE leads 
       SET lead_stage = ?, assigned_employee = '0', lead_status = 'new', updated_at = NOW()
       WHERE lead_id = ?`,
      [new_lead_stage, lead_id]
    );

    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee,
        changed_by, changed_by_department, changed_by_role, change_type, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        oldLead.lead_stage,
        new_lead_stage,
        oldLead.assigned_employee,
        "0",
        userId,
        departmentId,
        roleId,
        "lead_stage_changed",
        reason || "Not provided",
      ]
    );

    res.status(200).json({
      message: `Lead ${lead_id} moved to ${new_lead_stage} successfully.`,
      lead_id,
      old_lead_stage: oldLead.lead_stage,
      new_lead_stage,
      assigned_employee: "0",
      lead_status: "new",
      reason: reason || "Not provided",
    });
  } catch (error) {
    console.error("Error changing lead stage:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------------- Assign lead (Head) -------------------------- */
export const assignLeadToEmployee = async (req, res) => {
  try {
    const { lead_id, assigned_employee, reason } = req.body;
    const headId = req.user.employee_id;
    const department = "Solutions-Team";

    if (!lead_id || !assigned_employee) {
      return res
        .status(400)
        .json({ error: "lead_id and assigned_employee are required." });
    }

    const [existing] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [
      lead_id,
    ]);
    if (existing.length === 0)
      return res.status(404).json({ error: "Lead not found" });

    const oldLead = existing[0];

    await pool.query(
      "UPDATE leads SET assigned_employee = ?, lead_stage = ?, updated_at = NOW() WHERE lead_id = ?",
      [assigned_employee, department, lead_id]
    );

    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee,
        changed_by, changed_by_department, changed_by_role, change_type, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        oldLead.lead_stage,
        department,
        oldLead.assigned_employee,
        assigned_employee,
        headId,
        req.user.department_id,
        req.user.role_id,
        "lead_assigned",
        reason || "Not provided",
      ]
    );

    res.status(200).json({
      message: `Lead ${lead_id} assigned successfully`,
      lead_id,
      assigned_employee,
      lead_stage: department,
      assigned_by: headId,
      reason: reason || "Not provided",
    });
  } catch (error) {
    console.error("Error assigning lead:", error);
    res.status(500).json({ error: "Server error while assigning lead" });
  }
};

/* ------------------------ Get all leads (IpqsHead) ----------------------- */
export const getAllLeadsForIpqsHead = async (req, res) => {
  try {
    const { role_id, department_id, employee_id } = req.user;

    if (role_id !== "IpqsHead" || department_id !== "IpqsHead") {
      return res
        .status(403)
        .json({ error: "Forbidden: Only IpqsHead can access all leads." });
    }

    const [leads] = await pool.query(`SELECT * FROM leads ORDER BY created_at DESC`);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?`,
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    res.status(200).json({
      message: "All leads fetched successfully",
      viewed_by: employee_id,
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching all leads (IpqsHead):", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* --------------------------- Revert Follow-up --------------------------- */
export const revertLeadToNew = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query("SELECT lead_status FROM leads WHERE lead_id = ?", [id]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Lead not found" });

    if (rows[0].lead_status !== "follow-up") {
      return res
        .status(400)
        .json({ error: "Only leads in follow-up can be reverted to new" });
    }

    await pool.query(
      `UPDATE leads 
       SET lead_status = 'new', follow_up_reason = NULL, follow_up_date = NULL, follow_up_time = NULL, updated_at = NOW()
       WHERE lead_id = ?`,
      [id]
    );

    res.status(200).json({ message: `Lead ${id} reverted to new` });
  } catch (error) {
    console.error("Error reverting lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};



/* ---------------- POST: Create a New Lead Solution ---------------- */
export const createSolution = async (req, res) => {
  try {
    const { lead_id, solution_provided } = req.body;
    const employeeId = req.user.employee_id;
    const roleId = req.user.role_id;

    // ✅ Security Check: Only Solution Team and IpqsHead
    const allowedRoles = ["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only the Solution Team can add solutions." 
      });
    }

    // ✅ Basic Validation
    if (!lead_id || !solution_provided) {
      return res.status(400).json({ error: "lead_id and solution_provided are required." });
    }

    // ✅ Verify Lead Exists & Fetch Name/Company for Response
    const [leadCheck] = await pool.query(
      "SELECT lead_name, company_name FROM leads WHERE lead_id = ?", 
      [lead_id]
    );

    if (leadCheck.length === 0) {
      return res.status(404).json({ error: "Lead not found in the system." });
    }

    const { lead_name, company_name } = leadCheck[0];

    // ✅ Generate Current Date & Time safely
    const localDate = new Date();
    const tzOffset = localDate.getTimezoneOffset() * 60000;
    const localISO = new Date(localDate - tzOffset).toISOString();
    
    const currentDate = localISO.split('T')[0]; // YYYY-MM-DD
    const currentTime = localISO.split('T')[1].split('.')[0]; // HH:MM:SS

    // ✅ Insert into Database
    const query = `
      INSERT INTO lead_solutions 
      (lead_id, solution_provided, solution_date, solution_time, created_by) 
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const [result] = await pool.query(query, [
      lead_id, 
      solution_provided, 
      currentDate, 
      currentTime, 
      employeeId
    ]);

    return res.status(201).json({
      message: "Solution logged successfully",
      data: {
        solution_id: result.insertId,
        lead_id,
        lead_name,
        company_name,
        solution_provided,
        solution_date: currentDate,
        solution_time: currentTime,
        created_by: employeeId
      }
    });

  } catch (error) {
    console.error("Error creating solution:", error);
    res.status(500).json({ error: "Server error while saving the solution." });
  }
};


/* ---------------- GET: Fetch ALL Solutions ---------------- */
export const getAllSolutions = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Security Check: Only Solutions Team and IpqsHead
    const allowedRoles = ["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only the Solutions Team can view these solutions." 
      });
    }

    // ✅ Fetch ALL Solutions across all leads, including new location/priority fields
    const query = `
      SELECT 
        ls.solution_id,
        ls.lead_id,
        ls.solution_provided,
        ls.solution_date,
        ls.solution_time,
        ls.created_at,
        e.employee_id,
        e.first_name,
        e.last_name,
        e.username,
        l.lead_name,
        l.company_name,
        l.lead_priority,
        l.company_address,
        l.company_state,
        l.company_city,
        l.company_country
      FROM lead_solutions ls
      LEFT JOIN employees e 
        ON ls.created_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN leads l
        ON ls.lead_id COLLATE utf8mb4_unicode_ci = l.lead_id COLLATE utf8mb4_unicode_ci
      ORDER BY ls.solution_date DESC, ls.solution_time DESC
    `;

    const [rows] = await pool.query(query);

    // Format the response securely and include the new fields
    const formattedData = rows.map(row => ({
      solution_id: row.solution_id,
      lead_id: row.lead_id,
      lead_name: row.lead_name || "Unknown Lead",
      company_name: row.company_name || "Unknown Company",
      lead_priority: row.lead_priority || "Unassigned",
      company_address: row.company_address || "No Address Provided",
      company_city: row.company_city || "Unknown City",
      company_state: row.company_state || "Unknown State",
      company_country: row.company_country || "Unknown Country",
      solution_provided: row.solution_provided,
      date: row.solution_date,
      time: row.solution_time,
      logged_at: row.created_at,
      provided_by_id: row.employee_id,
      provided_by_name: (row.first_name && row.last_name) 
        ? `${row.first_name} ${row.last_name}` 
        : (row.username || "Unknown")
    }));

    return res.status(200).json({
      message: "All solutions fetched successfully",
      total_solutions: formattedData.length,
      data: formattedData
    });

  } catch (error) {
    console.error("Error fetching all solutions:", error);
    res.status(500).json({ error: "Server error while fetching solutions." });
  }
};

/* ---------------- GET: Solutions Dashboard Stats & TAT ---------------- */
export const getSolutionStats = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Security Check
    const allowedRoles = ["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only the Solutions Team can view these statistics." 
      });
    }

    // ✅ Determine Current Month & Year safely (avoids MySQL timezone mismatch)
    const localDate = new Date();
    const currentMonth = localDate.getMonth() + 1; // getMonth() is 0-indexed
    const currentYear = localDate.getFullYear();

    // ✅ Fetch Stats in a Single Optimized Query
    // We use TIMESTAMPDIFF to get the exact hours between lead creation and solution creation.
    const query = `
      SELECT 
        COUNT(ls.solution_id) AS total_solutions,
        COALESCE(SUM(CASE WHEN MONTH(ls.solution_date) = ? AND YEAR(ls.solution_date) = ? THEN 1 ELSE 0 END), 0) AS current_month_solutions,
        AVG(TIMESTAMPDIFF(HOUR, l.created_at, ls.created_at)) AS avg_tat_hours
      FROM lead_solutions ls
      LEFT JOIN leads l 
        ON ls.lead_id COLLATE utf8mb4_unicode_ci = l.lead_id COLLATE utf8mb4_unicode_ci
    `;

    const [results] = await pool.query(query, [currentMonth, currentYear]);
    const data = results[0];

    // ✅ Format the Math
    const totalSolutions = Number(data.total_solutions) || 0;
    const monthlySolutions = Number(data.current_month_solutions) || 0;
    
    // Convert average hours to days (rounded to 1 decimal place, e.g., 2.5 days)
    const avgTatHours = Number(data.avg_tat_hours) || 0;
    const avgTatDays = parseFloat((avgTatHours / 24).toFixed(1));

    return res.status(200).json({
      message: "Solution statistics fetched successfully",
      data: {
        total_solutions_provided: totalSolutions,
        solutions_this_month: monthlySolutions,
        average_turnaround_time_days: avgTatDays,
        average_turnaround_time_hours: parseFloat(avgTatHours.toFixed(1)) // Providing hours as a helpful fallback
      }
    });

  } catch (error) {
    console.error("Error fetching solution stats:", error);
    res.status(500).json({ error: "Server error while fetching statistics." });
  }
};


/* ---------------- GET: Weekly Incoming Leads (Mon-Sun) ---------------- */
export const getWeeklyIncomingStats = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Security Check
    const allowedRoles = ["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only the Solutions Team can view these statistics." 
      });
    }

    // ✅ 1. Calculate Monday to Sunday dates for the current week
    const today = new Date();
    // getDay() returns 0 for Sunday, 1 for Monday, etc.
    const dayOfWeek = today.getDay(); 
    // Find how many days to subtract to get to Monday
    const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - distanceToMonday);

    const weekData = [];
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // Build our baseline 7-day array
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek);
      currentDate.setDate(startOfWeek.getDate() + i);
      
      // Handle timezone offset to get perfect YYYY-MM-DD strings
      const tzOffset = currentDate.getTimezoneOffset() * 60000;
      const localISODate = new Date(currentDate - tzOffset).toISOString().split('T')[0];
      
      weekData.push({
        day: dayNames[i],
        date: localISODate,
        incoming_leads_count: 0
      });
    }

    const startDateStr = weekData[0].date;
    const endDateStr = weekData[6].date;

    // ✅ 2. Query the Backup Table 
    // FIX: Using the exact alias 'activity_date' in the GROUP BY clause
    const query = `
      SELECT 
        DATE_FORMAT(change_timestamp, '%Y-%m-%d') as activity_date, 
        COUNT(DISTINCT lead_id) as lead_count
      FROM lead_activity_backup
      WHERE new_lead_stage LIKE '%Solution%'
        AND DATE(change_timestamp) BETWEEN ? AND ?
      GROUP BY activity_date
    `;

    const [rows] = await pool.query(query, [startDateStr, endDateStr]);

    // ✅ 3. Merge DB Data with our Baseline Array
    rows.forEach(row => {
      const matchIndex = weekData.findIndex(day => day.date === row.activity_date);
      if (matchIndex !== -1) {
        weekData[matchIndex].incoming_leads_count = Number(row.lead_count);
      }
    });

    // ✅ 4. Send Response
    return res.status(200).json({
      message: "Weekly incoming solutions leads fetched successfully",
      week_range: `${startDateStr} to ${endDateStr}`,
      data: weekData
    });

  } catch (error) {
    console.error("Error fetching weekly incoming stats:", error);
    res.status(500).json({ error: "Server error while fetching weekly statistics." });
  }
};



/* ---------------- GET: Weekly Solutions Provided (Mon-Sun) ---------------- */
export const getWeeklySolutionsProvidedStats = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Security Check
    const allowedRoles = ["Solutions-Team-Head", "Solutions-Team-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only the Solutions Team can view these statistics." 
      });
    }

    // ✅ 1. Calculate Monday to Sunday dates for the current week
    const today = new Date();
    const dayOfWeek = today.getDay(); 
    const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - distanceToMonday);

    const weekData = [];
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // Build the baseline 7-day array
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek);
      currentDate.setDate(startOfWeek.getDate() + i);
      
      const tzOffset = currentDate.getTimezoneOffset() * 60000;
      const localISODate = new Date(currentDate - tzOffset).toISOString().split('T')[0];
      
      weekData.push({
        day: dayNames[i],
        date: localISODate,
        solutions_provided_count: 0 // Default to 0
      });
    }

    const startDateStr = weekData[0].date;
    const endDateStr = weekData[6].date;

    // ✅ 2. Query the lead_solutions Table 
    // We group by the formatted date string to avoid ONLY_FULL_GROUP_BY strict mode errors
    const query = `
      SELECT 
        DATE_FORMAT(solution_date, '%Y-%m-%d') as activity_date, 
        COUNT(solution_id) as solutions_count
      FROM lead_solutions
      WHERE solution_date BETWEEN ? AND ?
      GROUP BY activity_date
    `;

    const [rows] = await pool.query(query, [startDateStr, endDateStr]);

    // ✅ 3. Merge DB Data with our Baseline Array
    rows.forEach(row => {
      const matchIndex = weekData.findIndex(day => day.date === row.activity_date);
      if (matchIndex !== -1) {
        weekData[matchIndex].solutions_provided_count = Number(row.solutions_count);
      }
    });

    // ✅ 4. Send Response
    return res.status(200).json({
      message: "Weekly solutions provided fetched successfully",
      week_range: `${startDateStr} to ${endDateStr}`,
      data: weekData
    });

  } catch (error) {
    console.error("Error fetching weekly completed stats:", error);
    res.status(500).json({ error: "Server error while fetching weekly statistics." });
  }
};