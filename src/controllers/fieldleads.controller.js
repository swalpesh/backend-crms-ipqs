import { pool } from "../config/db.js";
import { validationResult } from "express-validator";

/* ----------------------------- Role Helpers ----------------------------- */
function isIpqsHead(user) {
  return user?.department_id === "IpqsHead" && user?.role_id === "IpqsHead";
}

function isFieldHead(user) {
  return user?.department_id === "Field-Marketing" && user?.role_id === "Field-Marketing-Head";
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
      
      // ✅ New Fields
      lead_type,
      lead_priority,
      expected_closing_date,
      expected_revenue,
      probability,
      mark_as_hot_lead
    } = req.body;

    const lead_id = await generateLeadId();
    const created_by = req.user.employee_id;

    // ✅ 1. Insert new lead
    await pool.query(
      `INSERT INTO leads 
      (
        lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
        company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
        industry_type, lead_requirement, notes, status, assigned_employee, created_by, lead_status,
        follow_up_reason, follow_up_date, follow_up_time, lead_stage,
        
        /* New Columns */
        lead_type, lead_priority, expected_closing_date, expected_revenue, probability, mark_as_hot_lead
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 'active', ?, ?, ?,
        ?, ?, ?, ?,
        
        /* New Values */
        ?, ?, ?, ?, ?, ?
      )`,
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
        assigned_employee || "0", // Default to "0" (Unassigned) if empty
        created_by,
        lead_status || "new",
        
        // Follow-up logic
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        
        lead_stage || "Field-Marketing",

        // ✅ New Fields Data
        lead_type || null,
        lead_priority || "Medium", // Default to Medium if not provided
        expected_closing_date || null,
        expected_revenue || 0.00,
        probability || 0,
        mark_as_hot_lead ? 1 : 0 // Ensure Boolean is stored as 1 or 0
      ]
    );

    // ✅ 2. Log activity in lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      [lead_id, lead_stage || "Field-Marketing", assigned_employee || "0"]
    );

    // ✅ 3. Handle attachments (optional)
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          "INSERT INTO lead_attachments (lead_id, file_name, file_path) VALUES (?,?,?)",
          [lead_id, file.originalname, file.path]
        );
      }
    }

    // ✅ 4. Return response
    return res.status(201).json({ 
      message: "Lead created successfully", 
      lead_id 
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

    return res.status(200).json({ message: "Leads fetched successfully", leads });
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


/* ------------------------- My Field leads (self) ------------------------- */
/* ---------------- List Leads by Employee (With Names & Counts) ---------------- */
export const listLeadsByEmployee = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;
    const { lead_status } = req.query;

    // ✅ Base Query: Select Lead + Join Employee Table twice (for Assigned & Creator)
    // We use aliases 'assignee' and 'creator' to distinguish between the two joins.
    let query = `
      SELECT 
        l.*,
        CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_employee_name,
        assignee.username AS assigned_employee_username,
        CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
        creator.username AS created_by_username
      FROM leads l
      LEFT JOIN employees assignee 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = assignee.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN employees creator 
        ON l.created_by COLLATE utf8mb4_unicode_ci = creator.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.assigned_employee = ? 
      AND l.lead_stage = 'Field-Marketing'
    `;

    const params = [employeeId];

    // ✅ Filter by Lead Status (if provided)
    if (lead_status) {
      if (!["new", "follow-up", "lost", "progress", "completed"].includes(lead_status)) {
        return res.status(400).json({ error: "Invalid lead_status value" });
      }
      query += " AND l.lead_status = ?";
      params.push(lead_status);
    }

    // ✅ Order by newest first
    query += " ORDER BY l.created_at DESC";

    const [leads] = await pool.query(query, params);

    // ✅ Calculate Counts
    let hotLeadsCount = 0;

    // ✅ Process Leads (Add Attachments & Count Hot Leads)
    for (const lead of leads) {
      // Count if it's a hot lead (ensure boolean check works for 1/0/true/false)
      if (lead.mark_as_hot_lead === 1 || lead.mark_as_hot_lead === true) {
        hotLeadsCount++;
      }

      // Fetch Attachments
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      // Fallback: If name is null (e.g., deleted employee), use username or "Unknown"
      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      // Remove raw username fields to keep JSON clean (optional)
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    // ✅ Return Response
    return res.status(200).json({
      message: "Leads fetched successfully",
      employee_id: employeeId,
      total_leads: leads.length,
      hot_leads_count: hotLeadsCount,
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
    const employeeId = req.user.employee_id; // from JWT

    // ✅ Fetch today's follow-ups for leads either created by OR assigned to this employee
    const [leads] = await pool.query(
      `SELECT * FROM leads 
       WHERE (created_by = ? OR assigned_employee = ?)
       AND lead_status = 'follow-up' 
       AND lead_stage = 'Field-Marketing'
       AND follow_up_date = CURDATE()
       ORDER BY follow_up_time ASC`,
      [employeeId, employeeId]
    );

    // ✅ Attach uploaded documents for each lead
    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
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


/* -------- Field-Marketing employees & their leads (Head or IpqsHead) ----- */
export const fieldMarketingAllLeads = async (req, res) => {
  try {
    if (!(isFieldHead(req.user) || isIpqsHead(req.user))) {
      return res.status(403).json({
        error: "Forbidden: Only Field-Marketing Head or IpqsHead can access this.",
      });
    }

    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id = 'Field-Marketing'"
    );

    const data = { employees: [], unassigned_leads: [] };

    for (const emp of employees) {
      const [leads] = await pool.query(
        "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Field-Marketing'",
        [emp.employee_id]
      );

      for (const lead of leads) {
        const [attachments] = await pool.query(
          "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
          [lead.lead_id]
        );
        lead.attachments = attachments;
      }

      data.employees.push({ ...emp, leads });
    }

    const [unassigned] = await pool.query(
      "SELECT * FROM leads WHERE assigned_employee = '0' AND lead_stage = 'Field-Marketing'"
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
      message: "Field-Marketing employees and their leads fetched successfully",
      department: "Field-Marketing",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Field-Marketing leads:", error);
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

    const allowedRoles = ["IpqsHead", "Field-Marketing-Head", "Field-Marketing-Employee"];

    if (!allowedRoles.includes(roleId)) {
      return res
        .status(403)
        .json({ error: "Forbidden: You are not allowed to change lead stage." });
    }

    if (!lead_id || !new_lead_stage) {
      return res.status(400).json({ error: "lead_id and new_lead_stage are required." });
    }

    const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadData.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

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

    return res.status(200).json({
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

/* -------------------------- Assign lead to Lead (Head & Employee both) -------------------------- */
export const assignLeadToFieldEmployee = async (req, res) => {
  try {
    const {
      lead_id,
      assigned_employee,
      field_visit_date,
      field_visit_time,
      field_visit_priority,
      field_visit_type,
      reason,
    } = req.body;

    const headId = req.user.employee_id;
    const department = "Field-Marketing";

    // ✅ Validation
    if (!lead_id || !assigned_employee) {
      return res.status(400).json({
        error: "lead_id and assigned_employee are required.",
      });
    }

    // ✅ Check if Lead Exists
    const [existing] = await pool.query(
      "SELECT * FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const oldLead = existing[0];

    // ✅ Update Lead with Field Marketing Details
    await pool.query(
      `
      UPDATE leads
      SET 
        assigned_employee = ?,
        lead_stage = ?,
        field_visit_date = ?,
        field_visit_time = ?,
        field_visit_priority = ?,
        field_visit_type = ?,
        field_visit_status = 'Pending',
        updated_at = NOW()
      WHERE lead_id = ?
      `,
      [
        assigned_employee,
        department, // Sets stage to 'Field-Marketing'
        field_visit_date || null,
        field_visit_time || null,
        field_visit_priority || "Medium",
        field_visit_type || "Specific",
        lead_id,
      ]
    );

    // ✅ Log Activity in Backup Table
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
        "field_visit_scheduled", // Specific change type
        reason || "Field Marketing visit scheduled",
      ]
    );

    res.status(200).json({
      message: "Field Marketing visit scheduled successfully",
      lead_id,
      assigned_employee,
      field_visit_date,
      field_visit_time,
      field_visit_priority,
      field_visit_type,
    });
  } catch (error) {
    console.error("Error scheduling field visit:", error);
    res.status(500).json({
      error: "Server error while scheduling field visit",
    });
  }
};

/* ------------------ Get Field Visit Details (Head & Team) ------------------ */
export const getFieldMarketingVisitDetails = async (req, res) => {
  try {
    const headId = req.user.employee_id;
    const roleId = req.user.role_id;

    // ✅ Strict check: Only Field-Marketing-Head allowed
    if (roleId !== "Field-Marketing-Head") {
      return res.status(403).json({
        error: "Forbidden: Only Field-Marketing Head can access visit details.",
      });
    }

    // ✅ Query: Select Field Marketing specific columns
    // Included COLLATE fix for the JOIN to prevent error 1267
    const query = `
      SELECT 
        l.lead_id,
        l.company_name, 
        l.lead_name, 
        l.field_visit_date, 
        l.field_visit_time, 
        l.field_visit_priority, 
        l.assigned_employee,
        e.first_name,
        e.last_name,
        e.username
      FROM leads l
      LEFT JOIN employees e 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Field-Marketing'
      ORDER BY l.field_visit_date DESC, l.field_visit_time ASC
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

      // Map database columns to clean JSON keys
      const visitData = {
        lead_id: row.lead_id,
        company_name: row.company_name,
        lead_name: row.lead_name,
        visit_date: row.field_visit_date,
        visit_time: row.field_visit_time,
        visit_priority: row.field_visit_priority,
        assigned_person: assignedPersonName,
        assigned_person_username: row.username || null,
        assigned_employee_id: row.assigned_employee // Helpful for frontend logic
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
      message: "Field Marketing visit details fetched successfully",
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
    console.error("Error fetching field visit details:", error);
    res.status(500).json({ error: "Server error" });
  }
};





/* ---------------- Get Unscheduled Field Marketing Leads assigned to particular employee (myactivity)---------------- */
export const getUnscheduledFieldLeads = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;

    // ✅ Query: Find leads in Field-Marketing with NULL visit date/time 
    // AND assigned to (or created by) the logged-in employee
    const query = `
      SELECT 
        l.*,
        CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_employee_name,
        assignee.username AS assigned_employee_username,
        CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
        creator.username AS created_by_username
      FROM leads l
      LEFT JOIN employees assignee 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = assignee.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN employees creator 
        ON l.created_by COLLATE utf8mb4_unicode_ci = creator.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Field-Marketing'
        AND l.field_visit_date IS NULL
        AND l.field_visit_time IS NULL
        AND l.assigned_employee = ?
      ORDER BY l.created_at DESC
    `;

    // Execute query
    const [leads] = await pool.query(query, [employeeId]);

    // ✅ Process Leads (Add Attachments & Clean up names)
    for (const lead of leads) {
      // Fetch Attachments
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      // Clean up names (Fallback to username or "Unknown")
      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      // Remove raw username fields to keep JSON clean
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    // ✅ Return Response
    return res.status(200).json({
      message: "Unscheduled Field Marketing leads fetched successfully",
      employee_id: employeeId,
      total_unscheduled_leads: leads.length,
      leads,
    });

  } catch (error) {
    console.error("Error fetching unscheduled field leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Scheduled Field Visits (Filtered by Date) (myactivity)---------------- */
export const getScheduledFieldVisits = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;
    const { date } = req.query; // Expecting format: YYYY-MM-DD

    // ✅ Base Query: Find assigned leads in Field-Marketing that HAVE a scheduled visit
    let query = `
      SELECT 
        l.*,
        CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_employee_name,
        assignee.username AS assigned_employee_username,
        CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
        creator.username AS created_by_username
      FROM leads l
      LEFT JOIN employees assignee 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = assignee.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN employees creator 
        ON l.created_by COLLATE utf8mb4_unicode_ci = creator.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Field-Marketing'
        AND l.assigned_employee = ?
        AND l.field_visit_date IS NOT NULL 
    `;

    const params = [employeeId];

    // ✅ Dynamic Date Filter
    if (date) {
      // Validate date format basic check (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Please use YYYY-MM-DD." });
      }
      
      query += ` AND l.field_visit_date = ?`;
      params.push(date);
    }

    // ✅ Order chronologically by the visit date and time
    query += ` ORDER BY l.field_visit_date ASC, l.field_visit_time ASC`;

    // Execute query
    const [leads] = await pool.query(query, params);

    // ✅ Process Leads (Add Attachments & Clean up names)
    for (const lead of leads) {
      // Fetch Attachments
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      // Clean up names
      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    // ✅ Return Response
    return res.status(200).json({
      message: date 
        ? `Scheduled visits for ${date} fetched successfully` 
        : "All scheduled visits fetched successfully",
      employee_id: employeeId,
      filter_date: date || "All Dates",
      total_visits: leads.length,
      leads,
    });

  } catch (error) {
    console.error("Error fetching scheduled field visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Update Field Visit Status (Start / Complete) ---------------- */
export const updateFieldVisitStatus = async (req, res) => {
  try {
    const { lead_id, status, location } = req.body;
    const employeeId = req.user.employee_id;

    // ✅ Basic Validation
    if (!lead_id || !status) {
      return res.status(400).json({ error: "lead_id and status are required." });
    }

    if (!["Pending", "Started", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Use Started, Completed, Cancelled, or Pending." });
    }

    // ✅ Verify Lead & Assignment
    // Adjusted to also fetch `lead_stage` for the backup logs
    const [existing] = await pool.query(
      "SELECT assigned_employee, lead_stage FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    const oldLead = existing[0];

    // Security check: Only the assigned employee can update their own visit status
    if (oldLead.assigned_employee !== employeeId) {
      return res.status(403).json({ error: "Forbidden: You are not assigned to this lead's field visit." });
    }

    // ✅ Dynamic Update Logic for the Leads Table
    let query = "";
    let params = [];

    if (status === "Started") {
      // If they are starting, a location is mandatory
      if (!location) {
        return res.status(400).json({ error: "Start location is required when starting a visit." });
      }
      query = `
        UPDATE leads 
        SET field_lead_visit_status = ?, field_visit_start_location = ?, updated_at = NOW() 
        WHERE lead_id = ?
      `;
      params = [status, location, lead_id];

    } else {
      // If Completed, Cancelled, or Pending, just update the status
      query = `
        UPDATE leads 
        SET field_lead_visit_status = ?, updated_at = NOW() 
        WHERE lead_id = ?
      `;
      params = [status, lead_id];
    }

    // Execute the leads table update
    await pool.query(query, params);

    // ✅ Insert into Lead Activity Backup
    // Determine the type of change and formulate a reason message based on status
    const changeType = status === "Started" ? "Field Visit Started" :
                       status === "Completed" ? "Field Visit Completed" :
                       `Field Visit ${status}`;

    const reasonText = status === "Started" 
      ? `Field visit started at location: ${location}` 
      : `Field visit status updated to ${status}`;

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
        oldLead.lead_stage, // Stage remains the same during a visit update
        oldLead.assigned_employee,
        oldLead.assigned_employee, // Assignee remains the same
        employeeId,
        req.user.department_id || "Field-Marketing", // Fallback if department_id is missing
        req.user.role_id,
        changeType,
        reasonText
      ]
    );

    // ✅ Return Response
    return res.status(200).json({
      message: `Visit status updated to '${status}' successfully.`,
      lead_id,
      status,
      start_location: status === "Started" ? location : undefined
    });

  } catch (error) {
    console.error("Error updating field visit status:", error);
    res.status(500).json({ error: "Server error while updating status" });
  }
};

/* ---------------- Reschedule Field Visit ---------------- */
export const rescheduleFieldVisits = async (req, res) => {
  try {
    const { lead_id, new_visit_date, new_visit_time, reason } = req.body;
    const employeeId = req.user.employee_id;
    const departmentId = req.user.department_id || "Field-Marketing";

    // ✅ Basic Validation
    if (!lead_id || !new_visit_date || !new_visit_time) {
      return res.status(400).json({ 
        error: "lead_id, new_visit_date, and new_visit_time are required." 
      });
    }

    // ✅ Verify Lead & Assignment
    const [existing] = await pool.query(
      "SELECT assigned_employee, lead_stage, field_visit_date, field_visit_time FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    const oldLead = existing[0];

    // Security check: Only the assigned employee can reschedule their own visit
    if (oldLead.assigned_employee !== employeeId) {
      return res.status(403).json({ 
        error: "Forbidden: You are not assigned to this lead's field visit." 
      });
    }

    // Format old date/time safely for the log message
    // Converts Date object to YYYY-MM-DD format
    const oldDate = oldLead.field_visit_date 
      ? new Date(oldLead.field_visit_date).toISOString().split('T')[0] 
      : "Unscheduled";
    const oldTime = oldLead.field_visit_time || "Unscheduled";

    // ✅ 1. Update Leads Table 
    // Updates the date/time and resets the visit status to 'Pending'
    await pool.query(
      `
      UPDATE leads 
      SET 
        field_visit_date = ?, 
        field_visit_time = ?, 
        field_lead_visit_status = 'Pending', 
        updated_at = NOW() 
      WHERE lead_id = ?
      `,
      [new_visit_date, new_visit_time, lead_id]
    );

    // ✅ 2. Insert into Lead Activity Backup
    // Build the dynamic string you requested
    const reasonText = `Lead rescheduled from ${oldDate} ${oldTime} to ${new_visit_date} ${new_visit_time} by employee ${employeeId}. Department: ${departmentId}. ${reason ? `Reason: ${reason}` : ''}`;

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
        oldLead.lead_stage, // Stage remains unchanged
        oldLead.assigned_employee,
        oldLead.assigned_employee, // Assignee remains unchanged
        employeeId,
        departmentId,
        req.user.role_id,
        "Field Visit Rescheduled",
        reasonText.trim()
      ]
    );

    // ✅ Return Response
    return res.status(200).json({
      message: "Field visit rescheduled successfully.",
      lead_id,
      new_visit_date,
      new_visit_time,
      previous_visit_date: oldDate,
      previous_visit_time: oldTime
    });

  } catch (error) {
    console.error("Error rescheduling field visit:", error);
    res.status(500).json({ error: "Server error while rescheduling visit" });
  }
};


/* ---------------- Get Completed Leads (Based on Activity Logs) ---------------- */

export const getCompletedFieldVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    const allowedRoles = ["Field-Marketing-Head", "Field-Marketing-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Field Marketing Team members can access this data.",
      });
    }

    let query = "";
    let params = [];

    // ✅ Shared Logic: We need to JOIN leads -> backup -> employees
    // This finds the user who performed the 'visit_completed' action
    const baseJoins = `
      FROM leads l
      LEFT JOIN lead_activity_backup lab 
        ON l.lead_id = lab.lead_id AND lab.change_type = 'Field Visit Completed'
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
    if (roleId === "Field-Marketing-Head") {
      query = `
        SELECT ${selectFields}
        ${baseJoins}
        WHERE l.field_lead_visit_status = 'Completed'
        ORDER BY l.updated_at DESC
      `;
    } 
    
    // ✅ CASE 2: EMPLOYEE (Sees only visits THEY completed or were assigned to)
    else {
      query = `
        SELECT DISTINCT ${selectFields}
        ${baseJoins}
        WHERE l.field_lead_visit_status = 'Completed'
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
      message: "Completed Field-Marketing visits fetched successfully",
      view_mode: roleId === "Field-Marketing-Head" ? "All Team Data" : "Personal History",
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching completed Field-Marketing visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};



// Dashboard Hot Leads API

/* ---------------- Get Hot Leads (Role-Based) ---------------- */
export const getHotFieldLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    // ✅ Base Query: Get leads in Field-Marketing that are marked as HOT
    let query = `
      SELECT 
        l.*,
        CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_employee_name,
        assignee.username AS assigned_employee_username,
        CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
        creator.username AS created_by_username
      FROM leads l
      LEFT JOIN employees assignee 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = assignee.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN employees creator 
        ON l.created_by COLLATE utf8mb4_unicode_ci = creator.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Field-Marketing'
        AND (l.mark_as_hot_lead = 1 OR l.mark_as_hot_lead = TRUE)
    `;

    const params = [];

    // ✅ Role-Based Access Control
    // If the user is NOT a Head, restrict the query to only their assigned leads
    const headRoles = ["Field-Marketing-Head", "IpqsHead"];
    if (!headRoles.includes(roleId)) {
      query += ` AND l.assigned_employee = ?`;
      params.push(employeeId);
    }

    // Order by newest first
    query += ` ORDER BY l.created_at DESC`;

    const [leads] = await pool.query(query, params);

    // ✅ Process Leads (Fetch Attachments & Clean up names)
    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      // Ensure names fall back to username or "Unknown" safely
      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    // ✅ Return Response
    return res.status(200).json({
      message: "Hot leads fetched successfully",
      view_mode: headRoles.includes(roleId) ? "All Team Hot Leads" : "My Assigned Hot Leads",
      total_hot_leads: leads.length,
      data: leads
    });

  } catch (error) {
    console.error("Error fetching hot field leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Field Marketing Employees & Detailed Expected Revenue ---------------- */
export const getFieldMarketingEmployeesRevenue = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    
    // ✅ Security check: Only Field-Marketing-Head and IpqsHead
    const allowedRoles = ["Field-Marketing-Head", "Field-Marketing-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only authorized Heads can access this data." 
      });
    }

    // ✅ 1. Fetch all active Field Marketing employees
    const empQuery = `
      SELECT 
        employee_id, first_name, last_name, username, email, contact_number
      FROM employees
      WHERE department_id = 'Field-Marketing' AND status = 'active'
    `;
    const [employees] = await pool.query(empQuery);

    // ✅ 2. Fetch all completed leads and their revenue details
    const leadsQuery = `
      SELECT 
        lab.old_assigned_employee AS employee_id,
        l.lead_id,
        l.lead_name,
        l.company_name,
        COALESCE(l.expected_revenue, 0) AS expected_revenue
      FROM lead_activity_backup lab
      INNER JOIN leads l ON lab.lead_id = l.lead_id
      WHERE lab.change_type = 'Field Visit Completed'
        AND l.field_lead_visit_status = 'Completed'
    `;
    const [leads] = await pool.query(leadsQuery);

    // ✅ 3. Grouping Logic & Global Total Calculation
    const employeeMap = {};
    let totalExpectedRevenueAllEmployees = 0; // NEW: Global counter

    // Initialize the map with all active Field Marketing employees
    employees.forEach(emp => {
      employeeMap[emp.employee_id] = {
        employee_id: emp.employee_id,
        employee_name: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : emp.username,
        email: emp.email,
        contact_number: emp.contact_number,
        completed_leads_count: 0,
        total_expected_revenue: 0,
        completed_leads: [] // This will hold the specific leads
      };
    });

    // Populate the map with lead data
    leads.forEach(lead => {
      const empId = lead.employee_id;
      
      // If the employee exists in our map, add the lead details to their array
      if (employeeMap[empId]) {
        const leadRevenue = Number(lead.expected_revenue);
        
        employeeMap[empId].completed_leads.push({
          lead_id: lead.lead_id,
          lead_name: lead.lead_name,
          company_name: lead.company_name,
          expected_revenue: leadRevenue
        });
        
        // Increment the individual employee's totals
        employeeMap[empId].completed_leads_count += 1;
        employeeMap[empId].total_expected_revenue += leadRevenue;
        
        // Increment the global total for all employees
        totalExpectedRevenueAllEmployees += leadRevenue; 
      }
    });

    // Convert the object map back into an array and sort by highest revenue
    const results = Object.values(employeeMap).sort((a, b) => b.total_expected_revenue - a.total_expected_revenue);

    // ✅ Return Response
    return res.status(200).json({
      message: "Field Marketing employees and detailed revenue fetched successfully",
      total_employees: results.length,
      total_expected_revenue_all_employees: totalExpectedRevenueAllEmployees, // NEW: Added to response
      data: results
    });

  } catch (error) {
    console.error("Error fetching detailed employee revenue:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get New Assigned Leads Summary (Employee Wise) ---------------- */
export const getNewAssignedLeadsSummary = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    
    // ✅ Security check: Only Field-Marketing-Head and IpqsHead
    const allowedRoles = ["Field-Marketing-Head", "Field-Marketing-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only authorized Heads can access this data." 
      });
    }

    // ✅ 1. Fetch all active Field Marketing employees
    const empQuery = `
      SELECT employee_id, first_name, last_name, username 
      FROM employees 
      WHERE department_id = 'Field-Marketing' AND status = 'active'
    `;
    const [employees] = await pool.query(empQuery);

    // ✅ 2. Fetch all 'new' leads assigned to the Field-Marketing stage
    // Using a subquery to get the exact time it was assigned to this employee
    const leadsQuery = `
      SELECT 
        l.lead_id, 
        l.lead_name, 
        l.company_name, 
        l.assigned_employee, 
        COALESCE(
          (SELECT MAX(change_timestamp) 
           FROM lead_activity_backup 
           WHERE lead_id = l.lead_id AND new_assigned_employee = l.assigned_employee),
          l.updated_at,
          l.created_at
        ) AS assigned_on
      FROM leads l
      WHERE l.lead_stage = 'Field-Marketing' 
        AND l.lead_status = 'new'
    `;
    const [leads] = await pool.query(leadsQuery);

    // ✅ 3. Grouping Logic & Today's Date Calculation
    const employeeMap = {};
    let totalNewLeads = 0;
    let totalNewLeadsToday = 0;

    // Helper function to check if a date is "today"
    const today = new Date();
    const isToday = (dateString) => {
      if (!dateString) return false;
      const d = new Date(dateString);
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    };

    // Initialize the map with all active Field Marketing employees
    employees.forEach((emp) => {
      employeeMap[emp.employee_id] = {
        employee_id: emp.employee_id,
        employee_name: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : emp.username,
        total_assigned: 0,
        today_assigned: 0, // NEW: Track today's assignments per employee
        assigned_leads: [] 
      };
    });

    // Populate the map with lead data
    leads.forEach((lead) => {
      const empId = lead.assigned_employee;
      
      // If the assigned employee exists in our Field Marketing map
      if (employeeMap[empId]) {
        employeeMap[empId].assigned_leads.push({
          lead_id: lead.lead_id,
          lead_name: lead.lead_name,
          company_name: lead.company_name,
          assigned_on: lead.assigned_on 
        });
        
        // Increment the individual employee's total counter
        employeeMap[empId].total_assigned += 1;
        
        // Increment global total
        totalNewLeads += 1;
        
        // Check if created/assigned today
        if (isToday(lead.assigned_on)) {
          totalNewLeadsToday += 1; // Increment global today counter
          employeeMap[empId].today_assigned += 1; // NEW: Increment employee's today counter
        }
      }
    });

    // Convert object to array and sort by those who have the most leads assigned overall
    const results = Object.values(employeeMap).sort((a, b) => b.total_assigned - a.total_assigned);

    // ✅ Return Response
    return res.status(200).json({
      message: "New assigned leads summary fetched successfully",
      total_new_leads_overall: totalNewLeads,
      total_new_leads_today: totalNewLeadsToday,
      data: results
    });

  } catch (error) {
    console.error("Error fetching new assigned leads summary:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Sales Funnel Data (Role-Aware) ---------------- */
export const getSalesFunnel = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    // ✅ Determine Access Level
    const isHead = ["Field-Marketing-Head", "IpqsHead"].includes(roleId);

    // Conditional SQL clauses based on role
    const assignedFilter = isHead ? "" : "AND assigned_employee = ?";
    const backupFilter = isHead ? "" : "AND old_assigned_employee = ?";
    const params = isHead ? [] : [employeeId];

    // ✅ 1. Get current leads, scheduled visits, and completed visits
    const baseQuery = `
      SELECT 
        COUNT(*) as current_leads,
        COALESCE(SUM(CASE WHEN field_visit_date IS NOT NULL THEN 1 ELSE 0 END), 0) as scheduled_visits,
        COALESCE(SUM(CASE WHEN field_lead_visit_status = 'Completed' THEN 1 ELSE 0 END), 0) as completed_visits
      FROM leads
      WHERE lead_stage = 'Field-Marketing' ${assignedFilter}
    `;
    const [baseResult] = await pool.query(baseQuery, params);

    // ✅ 2. Get transferred leads 
    // (Leads that used to be in Field-Marketing but were moved to another stage)
    const transferQuery = `
      SELECT COUNT(DISTINCT lead_id) as transferred_visits
      FROM lead_activity_backup
      WHERE old_lead_stage = 'Field-Marketing'
        AND new_lead_stage != 'Field-Marketing'
        ${backupFilter}
    `;
    const [transferResult] = await pool.query(transferQuery, params);

    // ✅ 3. Extract & Calculate Math
    const currentLeads = Number(baseResult[0].current_leads);
    const scheduledVisits = Number(baseResult[0].scheduled_visits);
    const completedVisits = Number(baseResult[0].completed_visits);
    const transferredVisits = Number(transferResult[0].transferred_visits);

    // The true 100% baseline includes leads currently here PLUS leads that moved forward
    const totalFunnelLeads = currentLeads + transferredVisits;

    // Helper to calculate percentage safely without dividing by zero
    const calcPercent = (part, total) => {
      if (total === 0) return "0%";
      return Math.round((part / total) * 100) + "%";
    };

    // Build the final payload formatted exactly for the UI
    const responseData = {
      total_leads: {
        count: totalFunnelLeads,
        percentage: totalFunnelLeads > 0 ? "100%" : "0%"
      },
      scheduled_visits: {
        count: scheduledVisits,
        percentage: calcPercent(scheduledVisits, totalFunnelLeads)
      },
      completed_visits: {
        count: completedVisits,
        percentage: calcPercent(completedVisits, totalFunnelLeads)
      },
      transferred_visits: {
        count: transferredVisits,
        percentage: calcPercent(transferredVisits, totalFunnelLeads)
      }
    };

    // ✅ Return Response
    return res.status(200).json({
      message: "Sales funnel data fetched successfully",
      view_mode: isHead ? "All Team Funnel" : "My Personal Funnel",
      data: responseData
    });

  } catch (error) {
    console.error("Error fetching sales funnel:", error);
    res.status(500).json({ error: "Server error" });
  }
};










/* ---------------- Today's Field Visits (All Employees) ---------------- */
export const FieldTeamTodaysVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Field-Marketing-Head or IpqsHead
    if (!["Field-Marketing-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Field-Marketing Head or IpqsHead can access this.",
      });
    }

    // ✅ Fetch employees in Field-Marketing
    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id = 'Field-Marketing'"
    );

    const data = { employees: [], unassigned_leads: [] };

    // ✅ 1. Get Today's Visits for each Employee
    for (const emp of employees) {
      const [leads] = await pool.query(
        `SELECT * FROM leads 
         WHERE assigned_employee = ? 
         AND lead_stage = 'Field-Marketing' 
         AND field_visit_date = CURDATE() 
         ORDER BY field_visit_time ASC`,
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
       AND lead_stage = 'Field-Marketing' 
       AND field_visit_date = CURDATE()
       ORDER BY field_visit_time ASC`
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
      message: "Today's Field-Marketing visits fetched successfully",
      date: new Date().toISOString().split('T')[0], // Shows current date YYYY-MM-DD
      accessed_by: roleId,
      department: "Field-Marketing",
      total_employees: data.employees.length,
      total_unassigned_todays_visits: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Today's Field-Marketing visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};













/* ------------------------ Get all leads (IpqsHead) ----------------------- */
export const getAllLeadsForIpqsHead = async (req, res) => {
  try {
    const { role_id, department_id, employee_id } = req.user;

    if (role_id !== "IpqsHead" || department_id !== "IpqsHead") {
      return res.status(403).json({ error: "Forbidden: Only IpqsHead can access all leads." });
    }

    const [leads] = await pool.query(`SELECT * FROM leads ORDER BY created_at DESC`);

    for (let lead of leads) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?`,
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
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

export const revertLeadToNew = async (req, res) => {
  try {
    const { id } = req.params; // lead_id

    const [rows] = await pool.query("SELECT lead_status FROM leads WHERE lead_id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Lead not found" });
    if (rows[0].lead_status !== "follow-up") {
      return res.status(400).json({ error: "Only leads in follow-up can be reverted to new" });
    }

    await pool.query(
      `UPDATE leads 
       SET lead_status = 'new', 
           follow_up_reason = NULL, 
           follow_up_date = NULL, 
           follow_up_time = NULL, 
           updated_at = NOW()
       WHERE lead_id = ?`,
      [id]
    );

    return res.status(200).json({ message: `Lead ${id} reverted to new` });
  } catch (error) {
    console.error("Error reverting lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};


