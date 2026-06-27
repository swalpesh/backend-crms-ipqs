import { pool } from "../config/db.js";
import { validationResult } from "express-validator";

/* ----------------------------- Role Helpers ----------------------------- */
function isIpqsHead(user) {
  return (
    user?.department_id === "IpqsHead" &&
    user?.role_id === "IpqsHead"
  );
}

// 📝 CHANGED: Function name updated to isTrafoAssociateHead
function isTrafoAssociateHead(user) {
  return (
    // 📝 CHANGED: department_id check updated to 'Trafo-Associates'
    user?.department_id === "Trafo-Associates" &&
    // 📝 CHANGED: role_id check updated to 'Trafo-Associates-Head'
    user?.role_id === "Trafo-Associates-Head"
  );
}

// 📝 CHANGED: Function name updated to isTrafoAssociateEmployee
function isTrafoAssociateEmployee(user) {
  return (
    // 📝 CHANGED: department_id check updated to 'Trafo-Associates'
    user?.department_id === "Trafo-Associates" &&
    // 📝 CHANGED: role_id check updated to 'Trafo-Associates-Employee'
    user?.role_id === "Trafo-Associates-Employee"
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
        assigned_employee || "0", 
        created_by,
        lead_status || "new",
        
        // Follow-up logic
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        
        // 📝 CHANGED: Default lead_stage mapped to "Trafo-Associates"
        lead_stage || "Trafo-Associates",

        lead_type || null,
        lead_priority || "Medium", 
        expected_closing_date || null,
        expected_revenue || 0.00,
        probability || 0,
        mark_as_hot_lead ? 1 : 0 
      ]
    );

    // ✅ 2. Log activity in lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      // 📝 CHANGED: Backup log default mapped to "Trafo-Associates"
      [lead_id, lead_stage || "Trafo-Associates", assigned_employee || "0"]
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
    const { id } = req.params; 
    const { lead_status, follow_up_reason, follow_up_date, follow_up_time } = req.body;

    if (!["follow-up", "lost"].includes(lead_status)) {
      return res.status(400).json({ error: "Invalid status. Only follow-up or lost allowed." });
    }

    const [prevRows] = await pool.query(
      `SELECT follow_up_reason, follow_up_date, follow_up_time, 
              assigned_employee, lead_stage
       FROM leads WHERE lead_id = ?`,
      [id]
    );

    if (prevRows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const previousData = prevRows[0];
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
        previousData.assigned_employee || null,
        follow_up_date,
        follow_up_time,
        follow_up_reason,
        previousData.lead_stage || null, 
      ];

      try {
        const [insertResult] = await pool.query(
          `INSERT INTO followup_history 
           (lead_id, previous_followup_date, previous_followup_time, previous_followup_reason, 
            updated_by_emp_id, new_followup_date, new_followup_time, new_followup_reason, department_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          backupData
        );
      } catch (err) {
        console.error("❌ INSERT ERROR:", err);
      }
    } else {
      params = [lead_status, null, null, null, id];
    }

    await pool.query(
      `UPDATE leads 
       SET lead_status = ?, follow_up_reason = ?, follow_up_date = ?, follow_up_time = ?, updated_at = NOW()
       WHERE lead_id = ?`,
      params
    );

    return res.status(200).json({ message: `Lead ${id} updated to ${lead_status}` });
  } catch (error) {
    console.error("💥 Fatal controller error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const listLeadsByEmployee = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;
    const { lead_status } = req.query;

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
      -- 📝 CHANGED: Filter by 'Trafo-Associates' stage
      AND l.lead_stage = 'Trafo-Associates'
    `;

    const params = [employeeId];

    if (lead_status) {
      if (!["new", "follow-up", "lost", "progress", "completed"].includes(lead_status)) {
        return res.status(400).json({ error: "Invalid lead_status value" });
      }
      query += " AND l.lead_status = ?";
      params.push(lead_status);
    }

    query += " ORDER BY l.created_at DESC";

    const [leads] = await pool.query(query, params);
    let hotLeadsCount = 0;

    for (const lead of leads) {
      if (lead.mark_as_hot_lead === 1 || lead.mark_as_hot_lead === true) {
        hotLeadsCount++;
      }

      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

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
    const employeeId = req.user.employee_id;

    const [leads] = await pool.query(
      `SELECT * FROM leads 
       WHERE (created_by = ? OR assigned_employee = ?)
       AND lead_status = 'follow-up' 
       -- 📝 CHANGED: Filter by 'Trafo-Associates' stage
       AND lead_stage = 'Trafo-Associates'
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

// 📝 CHANGED: Function name changed to TrafoAssociatesAllLeads
export const TrafoAssociatesAllLeads = async (req, res) => {
  try {
    const [employees] = await pool.query(
      // 📝 CHANGED: Query updated to fetch 'Trafo-Associates' employees
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id = 'Trafo-Associates'"
    );

    const data = { employees: [], unassigned_leads: [] };

    for (const emp of employees) {
      const [leads] = await pool.query(
        // 📝 CHANGED: Query updated to fetch 'Trafo-Associates' leads for employee
        "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Trafo-Associates'",
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
      // 📝 CHANGED: Query updated to fetch unassigned 'Trafo-Associates' leads
      "SELECT * FROM leads WHERE assigned_employee = '0' AND lead_stage = 'Trafo-Associates'"
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
      // 📝 CHANGED: Response message and department tag updated to 'Trafo-Associates'
      message: "Trafo Associates employees and their leads fetched successfully",
      department: "Trafo-Associates",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Trafo Associates leads:", error);
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

    // 📝 CHANGED: Allowed roles updated for Trafo Associates
    const allowedRoles = [
      "IpqsHead",
      "Trafo-Associates-Head",
      "Trafo-Associates-Employee",
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

    let newAssignedEmployee = '0'; 
    if (new_lead_stage === 'Solutions-Team') {
        newAssignedEmployee = 'IPQS-H5000'; 
    }

    await pool.query(
      `UPDATE leads 
       SET lead_stage = ?, assigned_employee = ?, lead_status = 'new', updated_at = NOW()
       WHERE lead_id = ?`,
      [new_lead_stage, newAssignedEmployee, lead_id]
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
        newAssignedEmployee, 
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
      assigned_employee: newAssignedEmployee, 
      lead_status: "new",
      reason: reason || "Not provided",
    });
  } catch (error) {
    console.error("Error changing lead stage:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------------- Assign lead to Employee -------------------------- */
// 📝 CHANGED: Function name updated to assignLeadToTrafoAssociateEmployee
export const assignLeadToTrafoAssociateEmployee = async (req, res) => {
  try {
    // 📝 CHANGED: Destructured request body variables renamed for trafo_associate
    const {
      lead_id,
      assigned_employee,
      trafo_associate_visit_date,
      trafo_associate_visit_time,
      trafo_associate_visit_priority,
      trafo_associate_visit_type,
      reason,
    } = req.body;

    const headId = req.user.employee_id;
    // 📝 CHANGED: Department variable set to 'Trafo-Associates'
    const department = "Trafo-Associates";

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

    // 📝 CHANGED: UPDATE query columns changed to trafo_associate_*
    await pool.query(
      `
      UPDATE leads
      SET 
        assigned_employee = ?,
        lead_stage = ?,
        trafo_associate_visit_date = ?,
        trafo_associate_visit_time = ?,
        trafo_associate_visit_priority = ?,
        trafo_associate_visit_type = ?,
        trafo_associate_visit_status = 'Pending',
        updated_at = NOW()
      WHERE lead_id = ?
      `,
      [
        assigned_employee,
        department, 
        // 📝 CHANGED: Mapping body variables to query params
        trafo_associate_visit_date || null,
        trafo_associate_visit_time || null,
        trafo_associate_visit_priority || "Medium",
        trafo_associate_visit_type || "Specific",
        lead_id,
      ]
    );

    // ✅ Log Activity
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
        // 📝 CHANGED: change_type string updated
        "trafo_associate_visit_scheduled", 
        // 📝 CHANGED: reason string updated
        reason || "Trafo Associates visit scheduled",
      ]
    );

    res.status(200).json({
      // 📝 CHANGED: Response message and payload keys updated
      message: "Trafo Associates visit scheduled successfully",
      lead_id,
      assigned_employee,
      trafo_associate_visit_date,
      trafo_associate_visit_time,
      trafo_associate_visit_priority,
      trafo_associate_visit_type,
    });
  } catch (error) {
    console.error("Error scheduling visit:", error);
    res.status(500).json({
      error: "Server error while scheduling visit",
    });
  }
};

/* ------------------ Get Visit Details (Head & Team) ------------------ */
// 📝 CHANGED: Function name updated to getTrafoAssociatesVisitDetails
export const getTrafoAssociatesVisitDetails = async (req, res) => {
  try {
    const headId = req.user.employee_id;
    const roleId = req.user.role_id;

    // 📝 CHANGED: Role check updated to 'Trafo-Associates-Head'
    if (roleId !== "Trafo-Associates-Head") {
      return res.status(403).json({
        error: "Forbidden: Only Trafo Associates Head can access visit details.",
      });
    }

    // 📝 CHANGED: Query updated to select trafo_associate_* columns and filter by stage
    const query = `
      SELECT 
        l.lead_id,
        l.company_name, 
        l.lead_name, 
        l.trafo_associate_visit_date, 
        l.trafo_associate_visit_time, 
        l.trafo_associate_visit_priority, 
        l.assigned_employee,
        e.first_name,
        e.last_name,
        e.username
      FROM leads l
      LEFT JOIN employees e 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Trafo-Associates'
      ORDER BY l.trafo_associate_visit_date DESC, l.trafo_associate_visit_time ASC
    `;

    const [rows] = await pool.query(query);

    const headVisits = [];
    const teamVisits = [];

    for (const row of rows) {
      let assignedPersonName = "Unassigned";
      
      if (row.first_name && row.last_name) {
        assignedPersonName = `${row.first_name} ${row.last_name}`;
      } else if (row.username) {
        assignedPersonName = row.username;
      }

      // 📝 CHANGED: Mapping trafo database columns to JSON object
      const visitData = {
        lead_id: row.lead_id,
        company_name: row.company_name,
        lead_name: row.lead_name,
        visit_date: row.trafo_associate_visit_date,
        visit_time: row.trafo_associate_visit_time,
        visit_priority: row.trafo_associate_visit_priority,
        assigned_person: assignedPersonName,
        assigned_person_username: row.username || null,
        assigned_employee_id: row.assigned_employee
      };

      if (row.assigned_employee === headId) {
        headVisits.push(visitData);
      } else {
        teamVisits.push(visitData);
      }
    }

    return res.status(200).json({
      // 📝 CHANGED: Response message updated
      message: "Trafo Associates visit details fetched successfully",
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
    console.error("Error fetching visit details:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Unscheduled Leads ---------------- */
// 📝 CHANGED: Function name updated to getUnscheduledTrafoAssociateLeads
export const getUnscheduledTrafoAssociateLeads = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;

    // 📝 CHANGED: Query updated to check trafo_associate_* columns and stage
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
      WHERE l.lead_stage = 'Trafo-Associates'
        AND l.trafo_associate_visit_date IS NULL
        AND l.trafo_associate_visit_time IS NULL
        AND l.assigned_employee = ?
      ORDER BY l.created_at DESC
    `;

    const [leads] = await pool.query(query, [employeeId]);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    return res.status(200).json({
      // 📝 CHANGED: Response message updated
      message: "Unscheduled Trafo Associates leads fetched successfully",
      employee_id: employeeId,
      total_unscheduled_leads: leads.length,
      leads,
    });

  } catch (error) {
    console.error("Error fetching unscheduled leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Scheduled Visits ---------------- */
// 📝 CHANGED: Function name updated to getScheduledTrafoAssociateVisits
export const getScheduledTrafoAssociateVisits = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;
    const { date } = req.query; 

    // 📝 CHANGED: Query updated for trafo_associate_visit_date format and stage
    let query = `
      SELECT 
        l.*,
        DATE_FORMAT(l.trafo_associate_visit_date, '%Y-%m-%d') AS trafo_associate_visit_date,
        CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_employee_name,
        assignee.username AS assigned_employee_username,
        CONCAT(creator.first_name, ' ', creator.last_name) AS created_by_name,
        creator.username AS created_by_username
      FROM leads l
      LEFT JOIN employees assignee 
        ON l.assigned_employee COLLATE utf8mb4_unicode_ci = assignee.employee_id COLLATE utf8mb4_unicode_ci
      LEFT JOIN employees creator 
        ON l.created_by COLLATE utf8mb4_unicode_ci = creator.employee_id COLLATE utf8mb4_unicode_ci
      WHERE l.lead_stage = 'Trafo-Associates'
        AND l.assigned_employee = ?
        AND l.trafo_associate_visit_date IS NOT NULL
    `;

    const params = [employeeId];

    if (date) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          error: "Invalid date format. Please use YYYY-MM-DD.",
        });
      }
      
      // 📝 CHANGED: Query updated to append trafo date filter
      query += ` AND l.trafo_associate_visit_date = ?`;
      params.push(date);
    }

    // 📝 CHANGED: Query ORDER BY updated to use trafo_associate columns
    query += ` ORDER BY l.trafo_associate_visit_date ASC, l.trafo_associate_visit_time ASC`;

    const [leads] = await pool.query(query, params);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );

      lead.attachments = attachments;

      if (!lead.assigned_employee_name?.trim()) {
        lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      }

      if (!lead.created_by_name?.trim()) {
        lead.created_by_name = lead.created_by_username || "Unknown";
      }

      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

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
    console.error("Error fetching scheduled visits:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Update Visit Status (Start / Complete) ---------------- */
// 📝 CHANGED: Function name updated to updateTrafoAssociateVisitStatus
export const updateTrafoAssociateVisitStatus = async (req, res) => {
  try {
    const { lead_id, status, location } = req.body;
    const employeeId = req.user.employee_id;

    if (!lead_id || !status) {
      return res.status(400).json({ error: "lead_id and status are required." });
    }

    if (!["Pending", "Started", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Use Started, Completed, Cancelled, or Pending." });
    }

    const [existing] = await pool.query(
      "SELECT assigned_employee, lead_stage FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    const oldLead = existing[0];

    if (oldLead.assigned_employee !== employeeId) {
      return res.status(403).json({ error: "Forbidden: You are not assigned to this lead's field visit." });
    }

    let query = "";
    let params = [];

    if (status === "Started") {
      if (!location) {
        return res.status(400).json({ error: "Start location is required when starting a visit." });
      }
      // 📝 CHANGED: Database UPDATE columns mapped to trafo_associate_*
      query = `
        UPDATE leads 
        SET trafo_associate_lead_visit_status = ?, trafo_associate_visit_start_location = ?, updated_at = NOW() 
        WHERE lead_id = ?
      `;
      params = [status, location, lead_id];

    } else {
      // 📝 CHANGED: Database UPDATE columns mapped to trafo_associate_*
      query = `
        UPDATE leads 
        SET trafo_associate_lead_visit_status = ?, updated_at = NOW() 
        WHERE lead_id = ?
      `;
      params = [status, lead_id];
    }

    await pool.query(query, params);

    // 📝 CHANGED: changeType logic strings updated for Trafo Associate
    const changeType = status === "Started" ? "Trafo Associate Visit Started" :
                       status === "Completed" ? "Trafo Associate Visit Completed" :
                       `Trafo Associate Visit ${status}`;

    // 📝 CHANGED: reasonText logic strings updated for Trafo Associates
    const reasonText = status === "Started" 
      ? `Trafo Associates visit started at location: ${location}` 
      : `Trafo Associates visit status updated to ${status}`;

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
        oldLead.lead_stage,
        oldLead.assigned_employee,
        oldLead.assigned_employee, 
        employeeId,
        // 📝 CHANGED: Fallback department updated
        req.user.department_id || "Trafo-Associates",
        req.user.role_id,
        changeType,
        reasonText
      ]
    );

    return res.status(200).json({
      message: `Visit status updated to '${status}' successfully.`,
      lead_id,
      status,
      start_location: status === "Started" ? location : undefined
    });

  } catch (error) {
    console.error("Error updating visit status:", error);
    res.status(500).json({ error: "Server error while updating status" });
  }
};

/* ---------------- Reschedule Visit ---------------- */
// 📝 CHANGED: Function name updated to rescheduleTrafoAssociateVisits
export const rescheduleTrafoAssociateVisits = async (req, res) => {
  try {
    const { lead_id, new_visit_date, new_visit_time, reason } = req.body;
    const employeeId = req.user.employee_id;
    // 📝 CHANGED: Fallback department updated
    const departmentId = req.user.department_id || "Trafo-Associates";

    if (!lead_id || !new_visit_date || !new_visit_time) {
      return res.status(400).json({ 
        error: "lead_id, new_visit_date, and new_visit_time are required." 
      });
    }

    // 📝 CHANGED: Selected columns updated to trafo_associate_*
    const [existing] = await pool.query(
      "SELECT assigned_employee, lead_stage, trafo_associate_visit_date, trafo_associate_visit_time FROM leads WHERE lead_id = ?",
      [lead_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    const oldLead = existing[0];

    if (oldLead.assigned_employee !== employeeId) {
      return res.status(403).json({ 
        error: "Forbidden: You are not assigned to this lead's field visit." 
      });
    }

    // 📝 CHANGED: Read from correct object properties
    const oldDate = oldLead.trafo_associate_visit_date 
      ? new Date(oldLead.trafo_associate_visit_date).toISOString().split('T')[0] 
      : "Unscheduled";
    const oldTime = oldLead.trafo_associate_visit_time || "Unscheduled";

    // 📝 CHANGED: UPDATE query columns updated to trafo_associate_*
    await pool.query(
      `
      UPDATE leads 
      SET 
        trafo_associate_visit_date = ?, 
        trafo_associate_visit_time = ?, 
        trafo_associate_lead_visit_status = 'Pending', 
        updated_at = NOW() 
      WHERE lead_id = ?
      `,
      [new_visit_date, new_visit_time, lead_id]
    );

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
        oldLead.lead_stage, 
        oldLead.assigned_employee,
        oldLead.assigned_employee, 
        employeeId,
        departmentId,
        req.user.role_id,
        // 📝 CHANGED: Backup log reason updated
        "Trafo Associate Visit Rescheduled",
        reasonText.trim()
      ]
    );

    return res.status(200).json({
      // 📝 CHANGED: Response message updated
      message: "Trafo Associates visit rescheduled successfully.",
      lead_id,
      new_visit_date,
      new_visit_time,
      previous_visit_date: oldDate,
      previous_visit_time: oldTime
    });

  } catch (error) {
    console.error("Error rescheduling visit:", error);
    res.status(500).json({ error: "Server error while rescheduling visit" });
  }
};

/* ---------------- Get Completed Leads ---------------- */
// 📝 CHANGED: Function name updated to getCompletedTrafoAssociateVisits
export const getCompletedTrafoAssociateVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    // 📝 CHANGED: Allowed roles updated
    const allowedRoles = ["Trafo-Associates-Head", "Trafo-Associates-Employee"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Trafo Associates Team members can access this data.",
      });
    }

    let query = "";
    let params = [];

    // 📝 CHANGED: JOIN condition mapped to check for 'Trafo Associate Visit Completed'
    const baseJoins = `
      FROM leads l
      LEFT JOIN lead_activity_backup lab 
        ON l.lead_id = lab.lead_id AND lab.change_type = 'Trafo Associate Visit Completed'
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

    // 📝 CHANGED: Role check condition updated to 'Trafo-Associates-Head'
    if (roleId === "Trafo-Associates-Head") {
      query = `
        SELECT ${selectFields}
        ${baseJoins}
        -- 📝 CHANGED: WHERE condition checks trafo_associate_lead_visit_status
        WHERE l.trafo_associate_lead_visit_status = 'Completed'
        ORDER BY l.updated_at DESC
      `;
    } else {
      query = `
        SELECT DISTINCT ${selectFields}
        ${baseJoins}
        -- 📝 CHANGED: WHERE condition checks trafo_associate_lead_visit_status
        WHERE l.trafo_associate_lead_visit_status = 'Completed'
        AND (lab.changed_by = ? OR lab.old_assigned_employee = ?)
        ORDER BY l.updated_at DESC
      `;
      params = [employeeId, employeeId];
    }

    const [leads] = await pool.query(query, params);

    for (const lead of leads) {
      if (lead.first_name && lead.last_name) {
        lead.completed_by_name = `${lead.first_name} ${lead.last_name}`;
      } else {
        lead.completed_by_name = lead.username || "Unknown";
      }

      delete lead.first_name;
      delete lead.last_name;
      delete lead.username;

      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
      // 📝 CHANGED: Response message updated
      message: "Completed Trafo Associates visits fetched successfully",
      // 📝 CHANGED: Role check in response object updated
      view_mode: roleId === "Trafo-Associates-Head" ? "All Team Data" : "Personal History",
      total: leads.length,
      leads,
    });
  } catch (error) {
    console.error("Error fetching completed visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Today's Visits (All Employees) ---------------- */
// 📝 CHANGED: Function name updated to TrafoAssociateTeamTodaysVisits
export const TrafoAssociateTeamTodaysVisits = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // 📝 CHANGED: Role check updated to include 'Trafo-Associates-Head'
    if (!["Trafo-Associates-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Trafo Associates Head or IpqsHead can access this.",
      });
    }

    let targetDate = req.query.date;
    if (!targetDate) {
      const localDate = new Date();
      const tzOffset = localDate.getTimezoneOffset() * 60000;
      targetDate = new Date(localDate - tzOffset).toISOString().split('T')[0];
    }
    
    // 📝 CHANGED: Query updated to search for 'Trafo-Associates' department
    const [employees] = await pool.query(
      `SELECT employee_id, first_name, last_name, username, email, department_id 
       FROM employees 
       WHERE department_id = 'Trafo-Associates' AND status = 'active'`
    );
    
    // 📝 CHANGED: Query updated to check trafo_associate_visit_date and lead_stage
    const [leads] = await pool.query(
      `SELECT * FROM leads 
       WHERE lead_stage = 'Trafo-Associates' 
       AND trafo_associate_visit_date = ? 
       ORDER BY trafo_associate_visit_time ASC`,
      [targetDate]
    );
    
    const employeeMap = {};
    const unassigned_leads = [];

    employees.forEach((emp) => {
      employeeMap[emp.employee_id] = {
        employee_id: emp.employee_id,
        employee_name: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : emp.username,
        email: emp.email,
        total_todays_visits: 0,
        leads: []
      };
    });

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      const empId = lead.assigned_employee;

      if (empId === "0" || !empId) {
        unassigned_leads.push(lead);
      } else if (employeeMap[empId]) {
        employeeMap[empId].leads.push(lead);
        employeeMap[empId].total_todays_visits += 1;
      } else {
        unassigned_leads.push(lead); 
      }
    }

    const employeeData = Object.values(employeeMap);

    res.status(200).json({
      // 📝 CHANGED: Response message and department tag updated
      message: `Trafo Associates visits for ${targetDate} fetched successfully`,
      date: targetDate, 
      accessed_by: roleId,
      department: "Trafo-Associates",
      total_employees: employeeData.length,
      total_unassigned_todays_visits: unassigned_leads.length,
      employees: employeeData,
      unassigned_leads: unassigned_leads
    });

  } catch (error) {
    console.error("Error fetching Today's visits:", error);
    res.status(500).json({ error: "Server error" });
  }
};


// Dashboard Hot Leads API

/* ---------------- Get Hot Leads (Role-Based) ---------------- */
// 📝 CHANGED: Function name updated to getHotTrafoAssociateLeads
export const getHotTrafoAssociateLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    const employeeId = req.user.employee_id;

    // 📝 CHANGED: WHERE condition updated for 'Trafo-Associates' lead stage
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
      WHERE l.lead_stage = 'Trafo-Associates'
        AND (l.mark_as_hot_lead = 1 OR l.mark_as_hot_lead = TRUE)
    `;

    const params = [];

    // 📝 CHANGED: Head roles check array updated
    const headRoles = ["Trafo-Associates-Head", "IpqsHead"];
    if (!headRoles.includes(roleId)) {
      query += ` AND l.assigned_employee = ?`;
      params.push(employeeId);
    }

    query += ` ORDER BY l.created_at DESC`;

    const [leads] = await pool.query(query, params);

    for (const lead of leads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;

      if (!lead.assigned_employee_name?.trim()) lead.assigned_employee_name = lead.assigned_employee_username || "Unknown";
      if (!lead.created_by_name?.trim()) lead.created_by_name = lead.created_by_username || "Unknown";
      
      delete lead.assigned_employee_username;
      delete lead.created_by_username;
    }

    return res.status(200).json({
      message: "Hot leads fetched successfully",
      view_mode: headRoles.includes(roleId) ? "All Team Hot Leads" : "My Assigned Hot Leads",
      total_hot_leads: leads.length,
      data: leads
    });

  } catch (error) {
    console.error("Error fetching hot leads:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Get Employees & Detailed Expected Revenue ---------------- */
// 📝 CHANGED: Function name updated to getTrafoAssociatesEmployeesRevenue
export const getTrafoAssociatesEmployeesRevenue = async (req, res) => {
  try {
    const roleId = req.user.role_id;
    
    // 📝 CHANGED: Allowed roles updated
    const allowedRoles = ["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only authorized Heads can access this data." 
      });
    }

    // 📝 CHANGED: Query updated to fetch 'Trafo-Associates' employees
    const empQuery = `
      SELECT 
        employee_id, first_name, last_name, username, email, contact_number
      FROM employees
      WHERE department_id = 'Trafo-Associates' AND status = 'active'
    `;
    const [employees] = await pool.query(empQuery);

    // 📝 CHANGED: Query updated to check trafo_associate_lead_visit_status and change_type
    const leadsQuery = `
      SELECT 
        lab.old_assigned_employee AS employee_id,
        l.lead_id,
        l.lead_name,
        l.company_name,
        COALESCE(l.expected_revenue, 0) AS expected_revenue
      FROM lead_activity_backup lab
      INNER JOIN leads l ON lab.lead_id = l.lead_id
      WHERE lab.change_type = 'Trafo Associate Visit Completed'
        AND l.trafo_associate_lead_visit_status = 'Completed'
    `;
    const [leads] = await pool.query(leadsQuery);

    const employeeMap = {};
    let totalExpectedRevenueAllEmployees = 0; 

    employees.forEach(emp => {
      employeeMap[emp.employee_id] = {
        employee_id: emp.employee_id,
        employee_name: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : emp.username,
        email: emp.email,
        contact_number: emp.contact_number,
        completed_leads_count: 0,
        total_expected_revenue: 0,
        completed_leads: [] 
      };
    });

    leads.forEach(lead => {
      const empId = lead.employee_id;
      
      if (employeeMap[empId]) {
        const leadRevenue = Number(lead.expected_revenue);
        
        employeeMap[empId].completed_leads.push({
          lead_id: lead.lead_id,
          lead_name: lead.lead_name,
          company_name: lead.company_name,
          expected_revenue: leadRevenue
        });
        
        employeeMap[empId].completed_leads_count += 1;
        employeeMap[empId].total_expected_revenue += leadRevenue;
        
        totalExpectedRevenueAllEmployees += leadRevenue; 
      }
    });

    const results = Object.values(employeeMap).sort((a, b) => b.total_expected_revenue - a.total_expected_revenue);

    return res.status(200).json({
      // 📝 CHANGED: Response message updated
      message: "Trafo Associates employees and detailed revenue fetched successfully",
      total_employees: results.length,
      total_expected_revenue_all_employees: totalExpectedRevenueAllEmployees, 
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
    
    // 📝 CHANGED: Allowed roles updated
    const allowedRoles = ["Trafo-Associates-Head", "Trafo-Associates-Employee", "IpqsHead"];
    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({ 
        error: "Forbidden: Only authorized Heads can access this data." 
      });
    }

    // 📝 CHANGED: Query updated to fetch 'Trafo-Associates' employees
    const empQuery = `
      SELECT employee_id, first_name, last_name, username 
      FROM employees 
      WHERE department_id = 'Trafo-Associates' AND status = 'active'
    `;
    const [employees] = await pool.query(empQuery);

    // 📝 CHANGED: Query updated for lead_stage 'Trafo-Associates'
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
      WHERE l.lead_stage = 'Trafo-Associates' 
        AND l.lead_status = 'new'
    `;
    const [leads] = await pool.query(leadsQuery);

    const employeeMap = {};
    let totalNewLeads = 0;
    let totalNewLeadsToday = 0;

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

    employees.forEach((emp) => {
      employeeMap[emp.employee_id] = {
        employee_id: emp.employee_id,
        employee_name: (emp.first_name && emp.last_name) ? `${emp.first_name} ${emp.last_name}` : emp.username,
        total_assigned: 0,
        today_assigned: 0, 
        assigned_leads: [] 
      };
    });

    leads.forEach((lead) => {
      const empId = lead.assigned_employee;
      
      if (employeeMap[empId]) {
        employeeMap[empId].assigned_leads.push({
          lead_id: lead.lead_id,
          lead_name: lead.lead_name,
          company_name: lead.company_name,
          assigned_on: lead.assigned_on 
        });
        
        employeeMap[empId].total_assigned += 1;
        totalNewLeads += 1;
        
        if (isToday(lead.assigned_on)) {
          totalNewLeadsToday += 1; 
          employeeMap[empId].today_assigned += 1; 
        }
      }
    });

    const results = Object.values(employeeMap).sort((a, b) => b.total_assigned - a.total_assigned);

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

    // 📝 CHANGED: Role check updated to check for 'Trafo-Associates-Head'
    const isHead = ["Trafo-Associates-Head", "IpqsHead"].includes(roleId);
    const params = isHead ? [] : [employeeId, employeeId];

    // 📝 CHANGED: Query updated to pull trafo_associate_* fields and check stage
    const funnelQuery = `
      SELECT 
        l.lead_id, 
        l.trafo_associate_visit_date, 
        l.trafo_associate_lead_visit_status, 
        l.lead_stage
      FROM leads l
      WHERE 
        (l.lead_stage = 'Trafo-Associates' ${isHead ? "" : "AND l.assigned_employee = ?"})
        OR 
        l.lead_id IN (
          SELECT lead_id 
          FROM lead_activity_backup 
          WHERE old_lead_stage = 'Trafo-Associates' 
            AND new_lead_stage != 'Trafo-Associates'
            ${isHead ? "" : "AND old_assigned_employee = ?"}
        )
    `;

    const [funnelLeads] = await pool.query(funnelQuery, params);

    let totalFunnelLeads = funnelLeads.length;
    let scheduledVisits = 0;
    let completedVisits = 0;
    let transferredVisits = 0;

    funnelLeads.forEach((lead) => {
      // 📝 CHANGED: Accessing the specific date column mapped to Trafo
      if (lead.trafo_associate_visit_date) {
        scheduledVisits++;
      }
      // 📝 CHANGED: Accessing the specific status column mapped to Trafo
      if (lead.trafo_associate_lead_visit_status === 'Completed') {
        completedVisits++;
      }
      // 📝 CHANGED: Checking lead stage transfer logic
      if (lead.lead_stage !== 'Trafo-Associates') {
        transferredVisits++;
      }
    });

    const calcPercent = (part, total) => {
      if (total === 0) return "0%";
      return Math.round((part / total) * 100) + "%";
    };

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