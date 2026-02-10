import { pool } from "../config/db.js";
import { validationResult } from "express-validator";

/* ----------------------------- Role Helpers ----------------------------- */
function isIpqsHead(user) {
  return (
    user?.department_id === "IpqsHead" &&
    user?.role_id === "IpqsHead"
  );
}

function isTechnicalHead(user) {
  return (
    user?.department_id === "Technical-Team" &&
    user?.role_id === "Technical-Team-Head"
  );
}

function isCorporateEmployee(user) {
  return (
    user?.department_id === "Technical-Team" &&
    user?.role_id === "Technical-Team-Employee"
  );
}

/* --------------------- Auto-generate Lead ID (L-001…) ------------------- */
async function generateLeadId() {
  const [rows] = await pool.query("SELECT COUNT(*) as count FROM leads");
  const next = rows[0].count + 1;
  return `L-${String(next).padStart(3, "0")}`;
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
        lead_stage || "Technical-Team",
      ]
    );

    // ✅ Step 2: Log the activity "New Lead Created" into lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      [lead_id, lead_stage || "Technical-Team", assigned_employee || "0"]
    );

    // ✅ Step 3: Attachments (if any)
    if (req.files?.length > 0) {
      for (const file of req.files) {
        await pool.query(
          "INSERT INTO lead_attachments (lead_id, file_name, file_path) VALUES (?,?,?)",
          [lead_id, file.originalname, file.path]
        );
      }
    }

    // ✅ Step 4: Return response
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

/* ----------------------- My Leads (Associate Employee) ------------------ */
export const listLeadsByEmployee = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;
    const { lead_status } = req.query;

    let query =
      "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Technical-Team'";
    const params = [employeeId];

    if (lead_status) {
      if (!["new", "follow-up", "lost", "progress", "completed"].includes(lead_status)) {
        return res.status(400).json({ error: "Invalid lead_status value" });
      }
      query += " AND lead_status = ?";
      params.push(lead_status);
    }

    const [leads] = await pool.query(query, params);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    res.status(200).json({
      message: "Leads fetched successfully",
      employee: employeeId,
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching employee leads:", error);
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
       AND lead_stage = 'Technical-Team'
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
export const TechnicalTeamAllLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Associate-Marketing-Head or IpqsHead
    if (!["Technical-Team-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Technical-Team Head or IpqsHead can access this.",
      });
    }

    // ✅ Handle both correct and misspelled department values
    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id IN ('Technical-Team', 'Technical-Team')"
    );

    const data = { employees: [], unassigned_leads: [] };

    for (const emp of employees) {
      const [leads] = await pool.query(
        "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Technical-Team' ORDER BY created_at DESC",
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
      "SELECT * FROM leads WHERE assigned_employee = '0' AND lead_stage = 'Technical-Team' ORDER BY created_at DESC"
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
      message: "Technical-Team employees and their leads fetched successfully",
      accessed_by: roleId,
      department: "Technical-Team",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Technical-Team leads:", error);
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
      "Technical-Team-Head",
      "Technical-Team-Employee",
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
    const {
      lead_id,
      assigned_employee,
      technical_visit_date,
      technical_visit_time,
      technical_visit_priority,
      technical_visit_type,
      reason,
    } = req.body;

    const headId = req.user.employee_id;
    const department = "Technical-Team";

    if (!lead_id || !assigned_employee) {
      return res.status(400).json({
        error: "lead_id and assigned_employee are required.",
      });
    }

    const [existing] = await pool.query(
      "SELECT * FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const oldLead = existing[0];

    await pool.query(
      `
      UPDATE leads
      SET 
        assigned_employee = ?,
        lead_stage = ?,
        technical_visit_date = ?,
        technical_visit_time = ?,
        technical_visit_priority = ?,
        technical_visit_type = ?,
        updated_at = NOW()
      WHERE lead_id = ?
      `,
      [
        assigned_employee,
        department,
        technical_visit_date || null,
        technical_visit_time || null,
        technical_visit_priority || null,
        technical_visit_type || "Specific",
        lead_id,
      ]
    );

    await pool.query(
      `
      INSERT INTO lead_activity_backup
      (
        lead_id,
        old_lead_stage,
        new_lead_stage,
        old_assigned_employee,
        new_assigned_employee,
        changed_by,
        changed_by_department,
        changed_by_role,
        change_type,
        reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        lead_id,
        oldLead.lead_stage,
        department,
        oldLead.assigned_employee,
        assigned_employee,
        headId,
        req.user.department_id,
        req.user.role_id,
        "technical_visit_scheduled",
        reason || "Technical visit scheduled",
      ]
    );

    res.status(200).json({
      message: "Technical visit scheduled successfully",
      lead_id,
      assigned_employee,
      technical_visit_date,
      technical_visit_time,
      technical_visit_priority,
      technical_visit_type,
    });
  } catch (error) {
    console.error("Error scheduling technical visit:", error);
    res.status(500).json({
      error: "Server error while scheduling technical visit",
    });
  }
};



/* ------------------------ Get all leads (IpqsHead) ----------------------- */
export const AssociateMarketingAllLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Associate-Marketing-Head or IpqsHead to access
    if (!["Associate-Marketing-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Associate-Marketing Head or IpqsHead can access this.",
      });
    }

    // ✅ Fetch both Associate-Marketing employees & head (tolerate typo in department name)
    const [employees] = await pool.query(
      `SELECT employee_id, username, email, role_id 
       FROM employees 
       WHERE LOWER(department_id) IN ('associate-marketing', 'assoicate-marketing')
       AND role_id IN ('Associate-Marketing-Employee', 'Associate-Marketing-Head')`
    );

    const data = { employees: [], unassigned_leads: [] };

    // ✅ For each employee, fetch their leads + attachments
    for (const emp of employees) {
      const [leads] = await pool.query(
        `SELECT * FROM leads 
         WHERE assigned_employee = ? 
         AND lead_stage = 'Associate-Marketing'
         ORDER BY created_at DESC`,
        [emp.employee_id]
      );

      for (const lead of leads) {
        const [attachments] = await pool.query(
          `SELECT id, file_name, file_path 
           FROM lead_attachments 
           WHERE lead_id = ?`,
          [lead.lead_id]
        );
        lead.attachments = attachments;
      }

      data.employees.push({
        ...emp,
        total_leads: leads.length,
        leads,
      });
    }

    // ✅ Fetch unassigned leads in Associate-Marketing stage
    const [unassigned] = await pool.query(
      `SELECT * FROM leads 
       WHERE assigned_employee = '0' 
       AND lead_stage = 'Associate-Marketing'
       ORDER BY created_at DESC`
    );

    for (const lead of unassigned) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path 
         FROM lead_attachments 
         WHERE lead_id = ?`,
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    data.unassigned_leads = unassigned;

    // ✅ Final response
    res.status(200).json({
      message: "Associate-Marketing employees, head, and their leads fetched successfully",
      accessed_by: roleId,
      department: "Associate-Marketing",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Associate-Marketing leads:", error);
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


/* ------------------ Get Visit Details (Head & Team) ------------------ */
export const getTechnicalTeamVisitDetails = async (req, res) => {
  try {
    const headId = req.user.employee_id;
    const roleId = req.user.role_id;

    // ✅ Strict check: Only Technical-Team-Head allowed
    if (roleId !== "Technical-Team-Head") {
      return res.status(403).json({
        error: "Forbidden: Only Technical-Team Head can access visit details.",
      });
    }

    // ✅ Query: FIX ADDED -> Added "COLLATE utf8mb4_unicode_ci" to the JOIN
    // This forces the comparison to ignore the database version mismatch
    const query = `
      SELECT 
        l.lead_id,
        l.company_name, 
        l.lead_name, 
        l.technical_visit_date, 
        l.technical_visit_time, 
        l.technical_visit_priority, 
        l.assigned_employee,
        e.first_name,
        e.last_name,
        e.username
      FROM leads l
      LEFT JOIN employees e 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Technical-Team'
      ORDER BY l.technical_visit_date DESC, l.technical_visit_time ASC
    `;

    const [rows] = await pool.query(query);

    // ✅ Data Segmentation: Split into Head's data and Team's data
    const headVisits = [];
    const teamVisits = [];

    for (const row of rows) {
      // Create a full name string, or fall back to username/Unassigned
      let assignedPersonName = "Unassigned";
      
      if (row.first_name && row.last_name) {
        assignedPersonName = `${row.first_name} ${row.last_name}`;
      } else if (row.username) {
        assignedPersonName = row.username;
      }

      const visitData = {
        lead_id: row.lead_id,
        company_name: row.company_name,
        lead_name: row.lead_name,
        visit_date: row.technical_visit_date,
        visit_time: row.technical_visit_time,
        visit_priority: row.technical_visit_priority,
        assigned_person: assignedPersonName,
        assigned_person_username: row.username || null 
      };

      // Check if the assigned employee ID matches the Head's ID
      if (row.assigned_employee === headId) {
        headVisits.push(visitData);
      } else {
        teamVisits.push(visitData);
      }
    }

    // ✅ Return response
    return res.status(200).json({
      message: "Technical team visit details fetched successfully",
      total_records: rows.length,
      head_data: {
        count: headVisits.length,
        visits: headVisits,
      },
      team_data: {
        count: teamVisits.length,
        visits: teamVisits,
      },
    });
  } catch (error) {
    console.error("Error fetching technical visit details:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Completed Technical Visits ---------------- */

export const getCompletedTechnicalVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    const allowedRoles = ["Technical-Team-Head", "Technical-Team-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Technical Team members can access this data.",
      });
    }

    let query = "";
    let params = [];

    // ✅ Shared Logic: We need to JOIN leads -> backup -> employees
    // This finds the user who performed the 'visit_completed' action
    const baseJoins = `
      FROM leads l
      LEFT JOIN lead_activity_backup lab 
        ON l.lead_id = lab.lead_id AND lab.change_type = 'visit_completed'
      LEFT JOIN employees e 
        ON lab.changed_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
    `;

    const selectFields = `
      l.*, 
      e.employee_id AS completed_by_id, 
      e.first_name, 
      e.last_name, 
      e.username
    `;

    // ✅ CASE 1: HEAD (Sees ALL completed visits)
    if (roleId === "Technical-Team-Head") {
      query = `
        SELECT ${selectFields}
        ${baseJoins}
        WHERE l.lead_visit_department = 'Technical' 
        AND l.lead_visit_status = 'Completed'
        ORDER BY l.updated_at DESC
      `;
    } 
    
    // ✅ CASE 2: EMPLOYEE (Sees only visits THEY completed or were assigned to)
    else {
      query = `
        SELECT DISTINCT ${selectFields}
        ${baseJoins}
        WHERE l.lead_visit_department = 'Technical' 
        AND l.lead_visit_status = 'Completed'
        AND (lab.changed_by = ? OR lab.old_assigned_employee = ?)
        ORDER BY l.updated_at DESC
      `;
      params = [employeeId, employeeId];
    }

    const [leads] = await pool.query(query, params);

    // ✅ Process results to format names and add attachments
    for (const lead of leads) {
      // 1. Format the "Completed By" Name
      if (lead.first_name && lead.last_name) {
        lead.completed_by_name = `${lead.first_name} ${lead.last_name}`;
      } else {
        lead.completed_by_name = lead.username || "Unknown";
      }

      // Cleanup: Remove raw join fields to keep JSON clean (optional)
      delete lead.first_name;
      delete lead.last_name;
      delete lead.username;

      // 2. Fetch Attachments
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
      message: "Completed technical visits fetched successfully",
      view_mode: roleId === "Technical-Team-Head" ? "All Team Data" : "Personal History",
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching completed technical visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* --------------------------- Start Visit --------------------------- */
export const startTechnicalVisit = async (req, res) => {
  try {
    const { id } = req.params; // lead_id passed in URL
    const roleId = req.user.role_id;
    const userId = req.user.employee_id;

    // ✅ Authorization: Only Technical Head & Employee allowed
    const allowedRoles = ["Technical-Team-Head", "Technical-Team-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not authorized to start a visit.",
      });
    }

    // ✅ Check if lead exists
    const [lead] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [id]);
    if (lead.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    // ✅ Update Query: Set lead_visit_status to 'In Progress'
    // We also log the time when the visit started (optional but recommended)
    await pool.query(
      `UPDATE leads 
       SET lead_status = 'progress', 
           updated_at = NOW() 
       WHERE lead_id = ?`,
      [id]
    );

    // ✅ Optional: Log this action in history (Good for tracking)
    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, changed_by, changed_by_role, change_type, reason, change_timestamp)
       VALUES (?, ?, ?, 'visit_started', 'Technical Visit Started', CURRENT_TIMESTAMP)`,
      [id, userId, roleId]
    );

    return res.status(200).json({
      message: "Visit started successfully.",
      lead_id: id,
      lead_visit_status: "In Progress"
    });

  } catch (error) {
    console.error("Error starting visit:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------- Technical Visit Start Location -------------------- */
export const storeVisitStartLocation = async (req, res) => {
  try {
    const { id } = req.params; // lead_id
    const { location } = req.body; // Expecting location string (e.g., "Lat: 12.34, Long: 56.78" or address)
    const roleId = req.user.role_id;

    // ✅ Authorization: Technical Head & Employee
    const allowedRoles = ["Technical-Team-Head", "Technical-Team-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not authorized to log visit locations.",
      });
    }

    // ✅ Validation
    if (!location) {
      return res.status(400).json({ error: "Location is required." });
    }

    // ✅ Check if lead exists
    const [lead] = await pool.query("SELECT lead_id FROM leads WHERE lead_id = ?", [id]);
    if (lead.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    // ✅ Update Query
    await pool.query(
      `UPDATE leads 
       SET technical_visit_start_location = ?, 
           updated_at = NOW() 
       WHERE lead_id = ?`,
      [location, id]
    );

    return res.status(200).json({
      message: "Visit start location saved successfully.",
      lead_id: id,
      location: location
    });

  } catch (error) {
    console.error("Error storing visit location:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ------------------------ Reschedule Visit ------------------------ */
export const rescheduleTechnicalVisit = async (req, res) => {
  try {
    const { id } = req.params; // lead_id
    const { technical_visit_date, technical_visit_time, reason } = req.body;
    
    const userId = req.user.employee_id;
    const roleId = req.user.role_id;
    const departmentId = req.user.department_id;

    // ✅ Authorization: Technical Head & Employee
    const allowedRoles = ["Technical-Team-Head", "Technical-Team-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not authorized to reschedule visits.",
      });
    }

    // ✅ Validation
    if (!technical_visit_date || !technical_visit_time || !reason) {
      return res.status(400).json({
        error: "Date, time, and reason are required for rescheduling.",
      });
    }

    // ✅ Fetch existing data (to log the "Old" date/time)
    const [existing] = await pool.query(
      "SELECT * FROM leads WHERE lead_id = ?",
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const oldLead = existing[0];
    const oldDate = oldLead.technical_visit_date; // Assuming these exist from previous steps
    const oldTime = oldLead.technical_visit_time;

    // ✅ Update Query: Set new date and time
    await pool.query(
      `UPDATE leads 
       SET technical_visit_date = ?, 
           technical_visit_time = ?, 
           lead_visit_status = 'pending',
           updated_at = NOW() 
       WHERE lead_id = ?`,
      [technical_visit_date, technical_visit_time, id]
    );

    // ✅ Log to lead_activity_backup
    // We format the reason to include the date change for clarity
    const detailedReason = `Rescheduled from ${oldDate || "N/A"} ${oldTime || ""} to ${technical_visit_date} ${technical_visit_time}. Reason: ${reason}`;

    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee,
        changed_by, changed_by_department, changed_by_role, change_type, reason, change_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        id,
        oldLead.lead_stage,       // Stage doesn't change
        oldLead.lead_stage,       // Stage doesn't change
        oldLead.assigned_employee,// Employee doesn't change
        oldLead.assigned_employee,// Employee doesn't change
        userId,
        departmentId,
        roleId,
        "visit_rescheduled",      // Change Type
        detailedReason            // Combined reason
      ]
    );

    return res.status(200).json({
      message: "Visit rescheduled successfully.",
      lead_id: id,
      new_date: technical_visit_date,
      new_time: technical_visit_time,
      status: "Pending"
    });

  } catch (error) {
    console.error("Error rescheduling visit:", error);
    res.status(500).json({ error: "Server error" });
  }
};


/* ------------------------End Visit ------------------------ */
export const completeTechnicalVisit = async (req, res) => {
  try {
    const { id } = req.params; // lead_id
    const userId = req.user.employee_id;
    const roleId = req.user.role_id;

    // ✅ Authorization: Technical Head & Employee
    const allowedRoles = ["Technical-Team-Head", "Technical-Team-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: You are not authorized to complete visits.",
      });
    }

    // ✅ Check if lead exists
    const [lead] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [id]);
    if (lead.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    // ✅ Update Query: Set Status to 'Completed' and record current time
    await pool.query(
      `UPDATE leads 
       SET lead_visit_status = 'Completed',
            lead_visit_department = 'Technical',
            lead_status = 'completed',
           technical_visit_complete_time = NOW(),
           updated_at = NOW() 
       WHERE lead_id = ?`,
      [id]
    );

    // ✅ Log to lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
       (lead_id, changed_by, changed_by_role, change_type, reason, change_timestamp)
       VALUES (?, ?, ?, 'visit_completed', 'Technical Visit Marked as Completed', CURRENT_TIMESTAMP)`,
      [id, userId, roleId]
    );

    return res.status(200).json({
      message: "Visit marked as completed successfully.",
      lead_id: id,
      status: "Completed",
      completed_at: new Date() // Returns current server time
    });

  } catch (error) {
    console.error("Error completing visit:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------- Internal Discussion: Add Message -------------------- */
export const addInternalMessage = async (req, res) => {
  try {
    const { lead_id, message } = req.body;
    const userId = req.user.employee_id;

    // ✅ Validation: Must have at least a message OR a file
    if (!lead_id) {
      return res.status(400).json({ error: "Lead ID is required." });
    }
    if (!message && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: "Message or attachment is required." });
    }

    // ✅ Check if lead exists
    const [lead] = await pool.query("SELECT lead_id FROM leads WHERE lead_id = ?", [lead_id]);
    if (lead.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    // ✅ Step 1: Insert Message
    const [result] = await pool.query(
      `INSERT INTO lead_discussions (lead_id, created_by, message, created_at) 
       VALUES (?, ?, ?, NOW())`,
      [lead_id, userId, message || ""]
    );

    const discussionId = result.insertId;

    // ✅ Step 2: Insert Attachments (if any)
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO lead_discussion_attachments (discussion_id, file_name, file_path) 
           VALUES (?, ?, ?)`,
          [discussionId, file.originalname, file.path]
        );
        attachments.push({ file_name: file.originalname, file_path: file.path });
      }
    }

    res.status(201).json({
      message: "Message posted successfully.",
      discussion_id: discussionId,
      lead_id,
      created_by: userId,
      message,
      attachments,
      created_at: new Date()
    });

  } catch (error) {
    console.error("Error posting internal message:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------- Internal Discussion: Get Messages -------------------- */
export const getInternalMessages = async (req, res) => {
  try {
    const { lead_id } = req.params;

    // ✅ 1. Get all messages for this lead + Join with Employees to get names
    // Note: Added 'COLLATE' to the JOIN to prevent "Illegal mix of collations" error
    const [messages] = await pool.query(
      `SELECT 
         d.id AS discussion_id, 
         d.lead_id, 
         d.message, 
         d.created_at, 
         d.created_by AS employee_id,
         e.first_name, 
         e.last_name, 
         e.username,
         e.role_id,
         e.photo  
       FROM lead_discussions d
       LEFT JOIN employees e 
         ON d.created_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
       WHERE d.lead_id = ?
       ORDER BY d.created_at ASC`, 
      [lead_id]
    );

    // ✅ 2. Get attachments for these messages
    for (const msg of messages) {
      const [files] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_discussion_attachments WHERE discussion_id = ?",
        [msg.discussion_id]
      );
      msg.attachments = files;
      
      // Format the author name neatly
      msg.author_name = (msg.first_name && msg.last_name) 
        ? `${msg.first_name} ${msg.last_name}` 
        : msg.username;
    }

    res.status(200).json({
      message: "Discussion history fetched successfully",
      total_messages: messages.length,
      data: messages
    });

  } catch (error) {
    console.error("Error fetching discussion:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Today's Technical Visits (All Employees) ---------------- */
export const TechnicalTeamTodaysVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Technical-Team-Head or IpqsHead
    if (!["Technical-Team-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Technical-Team Head or IpqsHead can access this.",
      });
    }

    // ✅ Fetch employees in Technical-Team
    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id = 'Technical-Team'"
    );

    const data = { employees: [], unassigned_leads: [] };

    // ✅ 1. Get Today's Visits for each Employee
    for (const emp of employees) {
      const [leads] = await pool.query(
        `SELECT * FROM leads 
         WHERE assigned_employee = ? 
         AND lead_stage = 'Technical-Team' 
         AND technical_visit_date = CURDATE() 
         ORDER BY technical_visit_time ASC`,
        [emp.employee_id]
      );

      for (const lead of leads) {
        const [attachments] = await pool.query(
          "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
          [lead.lead_id]
        );
        lead.attachments = attachments;
      }

      // Only push employee if they actually have visits today (Optional - typically Heads want to see everyone)
      // Currently pushing everyone, with 0 leads if they have none.
      data.employees.push({ ...emp, total_todays_visits: leads.length, leads });
    }

    // ✅ 2. Get Today's Unassigned Visits (Rare, but possible)
    const [unassigned] = await pool.query(
      `SELECT * FROM leads 
       WHERE assigned_employee = '0' 
       AND lead_stage = 'Technical-Team' 
       AND technical_visit_date = CURDATE()
       ORDER BY technical_visit_time ASC`
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
      message: "Today's Technical-Team visits fetched successfully",
      date: new Date().toISOString().split('T')[0], // Shows current date YYYY-MM-DD
      accessed_by: roleId,
      department: "Technical-Team",
      total_employees: data.employees.length,
      total_unassigned_todays_visits: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Today's Technical-Team visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};