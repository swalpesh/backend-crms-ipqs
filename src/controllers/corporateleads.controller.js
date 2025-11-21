import { pool } from "../config/db.js";
import { validationResult } from "express-validator";

/* ----------------------------- Role Helpers ----------------------------- */
function isIpqsHead(user) {
  return (
    user?.department_id === "IpqsHead" &&
    user?.role_id === "IpqsHead"
  );
}

function isCorporateHead(user) {
  return (
    user?.department_id === "Corporate-Marketing" &&
    user?.role_id === "Corporate-Marketing-Head"
  );
}

function isCorporateEmployee(user) {
  return (
    user?.department_id === "Corporate-Marketing" &&
    user?.role_id === "Corporate-Marketing-Employee"
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

    // ✅ Step 1: Insert lead data
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
        lead_stage || "Corporate-Marketing",
      ]
    );

    // ✅ Step 2: Log "New Lead Created" activity
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      [lead_id, lead_stage || "Corporate-Marketing", assigned_employee || "0"]
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

    // ✅ Step 4: Send Response
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
      "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Corporate-Marketing'";
    const params = [employeeId];

    if (lead_status) {
      if (!["new", "follow-up", "lost"].includes(lead_status)) {
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
       AND lead_stage = 'Corporate-Marketing'
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
export const CorporateMarketingAllLeads = async (req, res) => {
  try {
    const roleId = req.user.role_id;

    // ✅ Allow only Associate-Marketing-Head or IpqsHead
    if (!["Corporate-Marketing-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Corporate-Marketing Head or IpqsHead can access this.",
      });
    }

    // ✅ Handle both correct and misspelled department values
    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id IN ('Corporate-Marketing', 'Corporate-Marketing')"
    );

    const data = { employees: [], unassigned_leads: [] };

    for (const emp of employees) {
      const [leads] = await pool.query(
        "SELECT * FROM leads WHERE assigned_employee = ? AND lead_stage = 'Corporate-Marketing' ORDER BY created_at DESC",
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
      "SELECT * FROM leads WHERE assigned_employee = '0' AND lead_stage = 'Corporate-Marketing' ORDER BY created_at DESC"
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
      message: "Corporate-Marketing employees and their leads fetched successfully",
      accessed_by: roleId,
      department: "Corporate-Marketing",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Corporate-Marketing leads:", error);
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
      "Corporate-Marketing-Head",
      "Corporate-Marketing-Employee",
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
    const department = "Corporate-Marketing";

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
    const roleId = req.user.role_id;

    // ✅ Allow only Associate-Marketing-Head or IpqsHead to access
    if (!["Corporate-Marketing-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({
        error: "Forbidden: Only Corporate-Marketing Head or IpqsHead can access this.",
      });
    }

    // ✅ Fetch both Associate-Marketing employees & head (tolerate typo in department name)
    const [employees] = await pool.query(
      `SELECT employee_id, username, email, role_id 
       FROM employees 
       WHERE LOWER(department_id) IN ('corporate-marketing', 'corporate-marketing')
       AND role_id IN ('Corporate-Marketing-Employee', 'Corporate-Marketing-Head')`
    );

    const data = { employees: [], unassigned_leads: [] };

    // ✅ For each employee, fetch their leads + attachments
    for (const emp of employees) {
      const [leads] = await pool.query(
        `SELECT * FROM leads 
         WHERE assigned_employee = ? 
         AND lead_stage = 'Corporate-Marketing'
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
       AND lead_stage = 'Corporate-Marketing'
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
      message: "Corporate-Marketing employees, head, and their leads fetched successfully",
      accessed_by: roleId,
      department: "Corporate-Marketing",
      total_employees: data.employees.length,
      total_unassigned_leads: data.unassigned_leads.length,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching Corporate-Marketing leads:", error);
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
