import { pool } from "../config/db.js";
import { validationResult } from "express-validator";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";
import AdmZip from "adm-zip";
import mime from "mime-types";
import multer from "multer";
import { fileURLToPath } from "url";

/* ----------------------------- ES module dirs ---------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ----------------------------- role helpers ----------------------------- */
function isIpqsHead(user) {
  return user?.department_id === "IpqsHead" && user?.role_id === "IpqsHead";
}
function isTeleHead(user) {
  return user?.department_id === "Tele-Marketing" && user?.role_id === "Tele-Marketing-Head";
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
      lead_stage
    } = req.body;

    const lead_id = await generateLeadId();
    const created_by = req.user.employee_id; // from JWT

    // ✅ Insert into leads table
    await pool.query(
      `INSERT INTO leads 
      (lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
       company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
       industry_type, lead_requirement, notes, status, assigned_employee, created_by, lead_status,
       follow_up_reason, follow_up_date, follow_up_time, lead_stage)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`,
      [
        lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
        company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
        industry_type, lead_requirement, notes, assigned_employee, created_by, lead_status,
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        lead_stage
      ]
    );

    // ✅ Record "New Lead Created" in lead_activity_backup
    await pool.query(
      `INSERT INTO lead_activity_backup 
      (lead_id, new_lead_stage, new_assigned_employee, reason, change_timestamp)
      VALUES (?, ?, ?, 'New Lead Created', CURRENT_TIMESTAMP)`,
      [lead_id, lead_stage, assigned_employee]
    );

    // ✅ Attachments (store RELATIVE path)
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const relativePath = path.relative(process.cwd(), file.path).replace(/\\/g, "/");
        await pool.query(
          "INSERT INTO lead_attachments (lead_id, file_name, file_path) VALUES (?,?,?)",
          [lead_id, file.originalname, relativePath]
        );
      }
    }

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



/* --------------------------- Revert to new ------------------------------ */
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

/* ------------------------- My Tele leads (self) ------------------------- */
export const listLeadsByEmployee = async (req, res) => {
  try {
    const employeeId = req.user.employee_id; // from JWT
    const { lead_status } = req.query;

    let query = "SELECT * FROM leads WHERE created_by = ? AND lead_stage = ?";
    const params = [employeeId, "Tele-Marketing"];

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

    return res.status(200).json({
      message: "Leads fetched successfully",
      employee: employeeId,
      total: leads.length,
      leads
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

    const [leads] = await pool.query(
      `SELECT * FROM leads 
       WHERE created_by = ? 
       AND lead_status = 'follow-up' 
       AND lead_stage = 'Tele-Marketing'
       AND follow_up_date = CURDATE()
       ORDER BY follow_up_time ASC`,
      [employeeId]
    );

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
      leads
    });
  } catch (error) {
    console.error("Error fetching today's follow-ups:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------- Tele-Marketing employees & their leads (Head or IpqsHead) ----- */
export const listTeleMarketingEmployeesAndLeads = async (req, res) => {
  try {
    // Previously only Tele-Marketing-Head; now allow IpqsHead too.
    // if (!(isTeleHead(req.user) || isIpqsHead(req.user))) {
    //   return res.status(403).json({ error: "Forbidden: Only Tele-Marketing Head or IpqsHead can access this." });
    // }

    const departmentId = "Tele-Marketing";

    const [employees] = await pool.query(
      "SELECT employee_id, username, email, role_id FROM employees WHERE department_id = ?",
      [departmentId]
    );

    for (const emp of employees) {
      const [leads] = await pool.query(
        `SELECT * FROM leads 
         WHERE lead_stage = 'Tele-Marketing' 
         AND created_by = ? 
         ORDER BY created_at DESC`,
        [emp.employee_id]
      );

      for (const lead of leads) {
        const [attachments] = await pool.query(
          "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
          [lead.lead_id]
        );
        lead.attachments = attachments;
      }

      emp.leads = leads;
    }

    const [unassignedLeads] = await pool.query(
      `SELECT * FROM leads 
       WHERE lead_stage = 'Tele-Marketing' 
       AND assigned_employee = '0'
       ORDER BY created_at DESC`
    );

    for (const lead of unassignedLeads) {
      const [attachments] = await pool.query(
        "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    return res.status(200).json({
      message: "Tele-Marketing employees and their leads fetched successfully",
      department: departmentId,
      total_employees: employees.length,
      total_unassigned_leads: unassignedLeads.length,
      employees,
      unassigned_leads: unassignedLeads
    });
  } catch (error) {
    console.error("Error fetching employees & leads:", error);
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

    // ✅ Validate inputs
    if (!lead_id || !new_lead_stage) {
      return res.status(400).json({ error: "lead_id and new_lead_stage are required." });
    }

    // ✅ Fetch existing lead data
    const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadData.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }

    const oldLead = leadData[0];

    // ✅ Update lead stage, reset assignment and status
    await pool.query(
      `UPDATE leads 
       SET lead_stage = ?, 
           assigned_employee = '0', 
           lead_status = 'new', 
           updated_at = NOW()
       WHERE lead_id = ?`,
      [new_lead_stage, lead_id]
    );

    // ✅ Log activity in backup table
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
        reason || "Not provided"
      ]
    );

    // ✅ Success response
    return res.status(200).json({
      message: `Lead ${lead_id} successfully moved to ${new_lead_stage}.`,
      lead_id,
      old_lead_stage: oldLead.lead_stage,
      new_lead_stage,
      assigned_employee: "0",
      lead_status: "new",
      changed_by: userId,
      department: departmentId,
      role: roleId,
      reason: reason || "Not provided"
    });
  } catch (error) {
    console.error("Error changing lead stage:", error);
    return res.status(500).json({ error: "Server error" });
  }
};


/* -------------------------- Assign lead (Head) -------------------------- */
export const assignLeadToEmployee = async (req, res) => {
  try {
    const { lead_id, assigned_employee, new_lead_stage } = req.body;
    const actingUserId = req.user.employee_id;
    const departmentId = req.user.department_id;
    const roleId = req.user.role_id;

    // ✅ Allow only specific roles
    if (!["Tele-Marketing-Head", "IpqsHead"].includes(roleId)) {
      return res.status(403).json({ error: "Forbidden: Only Tele-Marketing-Head or IpqsHead can assign leads." });
    }

    // ✅ Validate input
    if (!lead_id || !assigned_employee) {
      return res.status(400).json({ error: "lead_id and assigned_employee are required." });
    }

    // ✅ Fetch current lead data
    const [leadData] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadData.length === 0) {
      return res.status(404).json({ error: "Lead not found." });
    }
    const oldLead = leadData[0];

    // ✅ Check if assigned employee exists
    const [empData] = await pool.query("SELECT * FROM employees WHERE employee_id = ?", [assigned_employee]);
    if (empData.length === 0) {
      return res.status(404).json({ error: "Assigned employee not found." });
    }

    let updatedLeadStage = oldLead.lead_stage;

    // ✅ If new stage provided (cross-department transfer)
    if (new_lead_stage && new_lead_stage !== oldLead.lead_stage) {
      updatedLeadStage = new_lead_stage;
    }

    // ✅ Update lead info
    await pool.query(
      `UPDATE leads 
       SET lead_stage = ?, assigned_employee = ?, lead_status = 'new', updated_at = NOW()
       WHERE lead_id = ?`,
      [updatedLeadStage, assigned_employee, lead_id]
    );

    // ✅ Log this activity
    await pool.query(
      `INSERT INTO lead_activity_backup 
        (lead_id, old_lead_stage, new_lead_stage, old_assigned_employee, new_assigned_employee, 
         changed_by, changed_by_department, changed_by_role, change_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        oldLead.lead_stage,
        updatedLeadStage,
        oldLead.assigned_employee,
        assigned_employee,
        actingUserId,
        departmentId,
        roleId,
        "lead_assigned"
      ]
    );

    return res.status(200).json({
      message: `Lead ${lead_id} assigned successfully to ${assigned_employee}`,
      lead_id,
      assigned_employee,
      new_lead_stage: updatedLeadStage,
      lead_status: "new"
    });
  } catch (error) {
    console.error("Error assigning lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getAllLeadsForIpqsHead = async (req, res) => {
  try {
    const { role_id, department_id, employee_id } = req.user;

    // ✅ Only IpqsHead can access
    if (role_id !== "IpqsHead" || department_id !== "IpqsHead") {
      return res.status(403).json({ error: "Forbidden: Only IpqsHead can access all leads." });
    }

    // ✅ Fetch all leads
    const [leads] = await pool.query(
      `SELECT * FROM leads ORDER BY created_at DESC`
    );

    // ✅ Attach documents to each lead
    for (let lead of leads) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?`,
        [lead.lead_id]
      );
      lead.attachments = attachments;
    }

    // ✅ Return response
    return res.status(200).json({
      message: "All leads fetched successfully",
      viewed_by: employee_id,
      total: leads.length,
      leads
    });
  } catch (error) {
    console.error("Error fetching all leads (IpqsHead):", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getLeadById = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const user = req.user;

    // ✅ Fetch lead
    const [leadRows] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadRows.length === 0) return res.status(404).json({ error: "Lead not found" });

    const lead = leadRows[0];

    // ✅ Access Control
    const canAccess =
      user.role_id === "IpqsHead" ||
      user.role_id === "Quotation-Team-Head" ||
      lead.created_by === user.employee_id ||
      lead.assigned_employee === user.employee_id ||
      (lead.lead_stage === user.department_id && user.role_id.endsWith("-Head")); // department head

    if (!canAccess) {
      return res.status(403).json({ error: "Forbidden: You do not have access to this lead." });
    }

    // ✅ Fetch attachments
    const [attachments] = await pool.query(
      "SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?",
      [lead_id]
    );
    lead.attachments = attachments;

    // ✅ Fetch assigned employee info
    if (lead.assigned_employee && lead.assigned_employee !== "0") {
      const [emp] = await pool.query(
        "SELECT employee_id, username, email, role_id, department_id FROM employees WHERE employee_id = ?",
        [lead.assigned_employee]
      );
      lead.assigned_employee_details = emp.length ? emp[0] : null;
    } else {
      lead.assigned_employee_details = null;
    }

    return res.status(200).json({
      message: "Lead details fetched successfully",
      lead,
    });
  } catch (error) {
    console.error("Error fetching lead details:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateLeadById = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const user = req.user;

    const [existingLead] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (existingLead.length === 0)
      return res.status(404).json({ error: "Lead not found" });

    const lead = existingLead[0];

    // ✅ Access Control
    const canEdit =
      user.role_id === "IpqsHead" ||
      lead.created_by === user.employee_id ||
      lead.assigned_employee === user.employee_id ||
      (lead.lead_stage === user.department_id && user.role_id.endsWith("-Head"));

    if (!canEdit) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to edit this lead." });
    }

    // ✅ Extract body fields
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
      lead_status,
      follow_up_reason,
      follow_up_date,
      follow_up_time,
    } = req.body;

    // ✅ Update record
    await pool.query(
      `UPDATE leads SET 
        lead_name = ?, company_name = ?, contact_person_name = ?, contact_person_phone = ?, 
        contact_person_email = ?, company_contact_number = ?, company_email = ?, 
        company_website = ?, company_address = ?, company_country = ?, company_state = ?, 
        company_city = ?, zipcode = ?, industry_type = ?, lead_requirement = ?, 
        notes = ?, lead_status = ?, follow_up_reason = ?, follow_up_date = ?, follow_up_time = ?, 
        updated_at = NOW()
       WHERE lead_id = ?`,
      [
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
        lead_status,
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        lead_id,
      ]
    );

    // ✅ Log change
    await pool.query(
      `INSERT INTO lead_activity_backup 
        (lead_id, changed_by, changed_by_department, changed_by_role, change_type, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        user.employee_id,
        user.department_id,
        user.role_id,
        "lead_updated",
        "Lead updated via API",
      ]
    );

    return res.status(200).json({
      message: "Lead updated successfully",
      lead_id,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getLeadActivityById = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const user = req.user;

    // ✅ 1. Check if lead exists
    const [leadRows] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadRows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const lead = leadRows[0];

    // ✅ 2. Access Control
    const canAccess =
      user.role_id === "IpqsHead" ||
      user.role_id === "Quotation-Team-Head" ||
      lead.created_by === user.employee_id ||
      lead.assigned_employee === user.employee_id ||
      (lead.lead_stage === user.department_id && user.role_id.endsWith("-Head"));

    if (!canAccess) {
      return res.status(403).json({
        error: "Forbidden: You do not have permission to view this lead's activity log.",
      });
    }

    // ✅ 3. Fetch activity history (correct timestamp column)
    const [activities] = await pool.query(
      `SELECT 
          id,
          lead_id,
          old_lead_stage,
          new_lead_stage,
          old_assigned_employee,
          new_assigned_employee,
          changed_by,
          changed_by_department,
          changed_by_role,
          change_type,
          reason,
          change_timestamp
        FROM lead_activity_backup
        WHERE lead_id = ?
        ORDER BY change_timestamp DESC`,
      [lead_id]
    );

    // ✅ 4. Add employee details
    for (const activity of activities) {
      const [emp] = await pool.query(
        "SELECT employee_id, username, email, role_id FROM employees WHERE employee_id = ?",
        [activity.changed_by]
      );
      activity.changed_by_details = emp.length ? emp[0] : null;
    }

    return res.status(200).json({
      message: "Lead activity history fetched successfully",
      lead_id,
      total_activities: activities.length,
      activities,
    });
  } catch (error) {
    console.error("Error fetching lead activity:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------------------------------------------------------------- */
/*                             MULTER STORAGE SETUP                            */
/* -------------------------------------------------------------------------- */
const notesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads", "notes");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

export const uploadNotesFiles = multer({
  storage: notesStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
});

/* -------------------------------------------------------------------------- */
/*                          FILE COMPRESSION HELPERS                           */
/* -------------------------------------------------------------------------- */
const compressImage = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  if (!isImage) return false;

  try {
    const compressedPath = filePath.replace(ext, `_compressed${ext}`);
    await sharp(filePath)
      .resize({ width: 1280 })
      .jpeg({ quality: 70 })
      .toFile(compressedPath);

    fs.unlinkSync(filePath);
    fs.renameSync(compressedPath, filePath);

    console.log(`✅ Image compressed: ${path.basename(filePath)}`);
    return true;
  } catch (err) {
    console.error(`❌ Image compression failed for ${filePath}:`, err);
    return false;
  }
};

const compressOtherFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  if (isImage) return false;

  try {
    const zipPath = filePath.replace(ext, `.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);
    archive.file(filePath, { name: path.basename(filePath) });
    await archive.finalize();

    fs.unlinkSync(filePath);
    fs.renameSync(zipPath, filePath); // rename back to original name
    console.log(`✅ File zipped (compressed): ${path.basename(filePath)}`);
    return true;
  } catch (err) {
    console.error(`❌ Zip compression failed for ${filePath}:`, err);
    return false;
  }
};

const compressFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    await compressImage(filePath);
  } else {
    await compressOtherFile(filePath);
  }
};

/* -------------------------------------------------------------------------- */
/*                        AUTO DECOMPRESSION FOR RETRIEVAL                     */
/* -------------------------------------------------------------------------- */
const decompressIfZipped = (filePath) => {
  try {
    // Check if file is ZIP using header bytes
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    const isZip = buffer.toString("utf8", 0, 2) === "PK";
    if (!isZip) return false;

    const tmpDir = path.join(path.dirname(filePath), "unzipped");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const zip = new AdmZip(filePath);
    zip.extractAllTo(tmpDir, true);
    const entries = zip.getEntries();
    if (entries.length === 0) return false;

    const extractedFilePath = path.join(tmpDir, entries[0].entryName);
    console.log(`✅ Decompressed on the fly: ${entries[0].entryName}`);
    return extractedFilePath;
  } catch (err) {
    console.error("❌ Decompression failed:", err);
    return false;
  }
};

/* -------------------------------------------------------------------------- */
/*                            HELPER: SAVE RELATIVE PATH                      */
/* -------------------------------------------------------------------------- */
export const saveNoteAttachments = async (noteId, files) => {
  if (!files || files.length === 0) return;

  for (const file of files) {
    await compressFile(file.path);

    const relativePath = path
      .relative(process.cwd(), file.path)
      .replace(/\\/g, "/");

    await pool.query(
      "INSERT INTO lead_note_attachments (note_id, file_name, file_path) VALUES (?, ?, ?)",
      [noteId, file.originalname, relativePath]
    );
  }
};

/* -------------------------------------------------------------------------- */
/*                              ADD NOTE TO LEAD                              */
/* -------------------------------------------------------------------------- */
export const addLeadNote = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const { title, note } = req.body;
    const user = req.user;

    const [leadRows] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadRows.length === 0)
      return res.status(404).json({ error: "Lead not found" });
    const lead = leadRows[0];

    const canAccess =
      user.role_id === "IpqsHead" ||
      user.role_id === "Quotation-Team-Head" ||
      lead.created_by === user.employee_id ||
      lead.assigned_employee === user.employee_id ||
      (lead.lead_stage === user.department_id && user.role_id.endsWith("-Head"));

    if (!canAccess)
      return res.status(403).json({ error: "Forbidden: You cannot add a note for this lead." });

    const [result] = await pool.query(
      `INSERT INTO lead_notes 
        (lead_id, title, note, created_by, created_by_department, created_by_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [lead_id, title, note, user.employee_id, user.department_id, user.role_id]
    );

    const noteId = result.insertId;

    if (req.files && req.files.length > 0) {
      await saveNoteAttachments(noteId, req.files);
    }

    return res.status(201).json({
      message: "Note added successfully",
      lead_id,
      note_id: noteId,
      attachments_uploaded: req.files ? req.files.length : 0,
    });
  } catch (error) {
    console.error("Error adding lead note:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------------------------------------------------------------- */
/*                          GET ALL NOTES FOR A LEAD                          */
/* -------------------------------------------------------------------------- */
export const getLeadNotes = async (req, res) => {
  try {
    const { lead_id } = req.params;
    const user = req.user;
    const BASE_URL = `${req.protocol}://${req.get("host")}`;

    const [leadRows] = await pool.query("SELECT * FROM leads WHERE lead_id = ?", [lead_id]);
    if (leadRows.length === 0)
      return res.status(404).json({ error: "Lead not found" });
    const lead = leadRows[0];

    const canAccess =
      user.role_id === "IpqsHead" ||
      user.role_id === "Quotation-Team-Head" ||
      lead.created_by === user.employee_id ||
      lead.assigned_employee === user.employee_id ||
      (lead.lead_stage === user.department_id && user.role_id.endsWith("-Head"));

    if (!canAccess)
      return res.status(403).json({ error: "Forbidden: You cannot view notes for this lead." });

    const [notes] = await pool.query(
      `SELECT 
          n.id AS note_id, 
          n.lead_id, 
          n.title, 
          n.note, 
          n.created_by, 
          n.created_by_department, 
          n.created_by_role, 
          n.created_at, 
          e.username AS created_by_name, 
          e.email AS created_by_email, 
          e.department_id AS emp_department, 
          e.role_id AS emp_role
       FROM lead_notes n
       LEFT JOIN employees e 
         ON n.created_by COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
       WHERE n.lead_id = ?
       ORDER BY n.created_at DESC`,
      [lead_id]
    );

    // ✅ Attach uploaded files and auto-decompress zipped PDFs
    for (const n of notes) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path, uploaded_at 
         FROM lead_note_attachments 
         WHERE note_id = ?`,
        [n.note_id]
      );

      for (const a of attachments) {
  const absolutePath = path.join(process.cwd(), a.file_path);
  const decompressedPath = decompressIfZipped(absolutePath);

  // ✅ If decompressed, use that path instead
  const finalPath = decompressedPath || absolutePath;

  // ✅ Generate proper URL (includes 'unzipped/' automatically)
  a.file_url = `${BASE_URL}/${path
    .relative(process.cwd(), finalPath)
    .replace(/\\/g, "/")}`;

  a.mime_type = mime.lookup(finalPath) || "application/octet-stream";
}

      n.attachments = attachments;
      n.created_by_details = {
        employee_id: n.created_by,
        username: n.created_by_name,
        email: n.created_by_email,
        department_id: n.emp_department,
        role_id: n.emp_role,
      };
    }

    return res.status(200).json({
      message: "Lead notes fetched successfully",
      lead_id,
      total_notes: notes.length,
      notes,
    });
  } catch (error) {
    console.error("Error fetching lead notes:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* -------------------------------------------------------------------------- */
/*                   GET ALL LEADS ACCESSIBLE TO LOGGED-IN USER               */
/* -------------------------------------------------------------------------- */
export const getAccessibleLeads = async (req, res) => {
  try {
    const user = req.user;
    const { employee_id, role_id } = user;

    console.log("🧩 User accessing leads:", {
      employee_id,
      role_id,
      department_id: user.department_id,
    });

    let query = "";
    let params = [];

    // ✅ Case 1: IpqsHead can view all leads
    if (role_id === "IpqsHead") {
      query = "SELECT * FROM leads ORDER BY created_at DESC";
      console.log("🔍 Query: Fetching all leads (IpqsHead access)");
    }
    // ✅ Case 2: Other employees → only leads created by or assigned to them
    else {
      query = `
        SELECT * FROM leads
        WHERE (created_by = ? OR assigned_employee = ?)
        ORDER BY created_at DESC
      `;
      params = [employee_id, employee_id];
      console.log("🔍 Query: Fetching leads for employee", employee_id);
    }

    // ✅ Execute query
    const [leads] = await pool.query(query, params);

    if (leads.length === 0) {
      return res.status(404).json({
        message: "No leads found for this user.",
        viewed_by: employee_id,
      });
    }

    // ✅ Attach uploaded files for each lead
    for (const lead of leads) {
      const [attachments] = await pool.query(
        `SELECT id, file_name, file_path FROM lead_attachments WHERE lead_id = ?`,
        [lead.lead_id]
      );
      lead.attachments = attachments;

      // ✅ Include assigned employee details if any
      if (lead.assigned_employee && lead.assigned_employee !== "0") {
        const [emp] = await pool.query(
          `SELECT employee_id, username, email, role_id, department_id FROM employees WHERE employee_id = ?`,
          [lead.assigned_employee]
        );
        lead.assigned_employee_details = emp.length ? emp[0] : null;
      } else {
        lead.assigned_employee_details = null;
      }
    }

    // ✅ Response
    return res.status(200).json({
      message:
        role_id === "IpqsHead"
          ? "All leads fetched successfully (IpqsHead access)"
          : "Leads created by or assigned to you fetched successfully",
      viewed_by: employee_id,
      role: role_id,
      total_leads: leads.length,
      leads,
    });
  } catch (error) {
    console.error("❌ Error fetching accessible leads:", error);
    return res.status(500).json({ error: "Server error" });
  }
};


export const getFollowupHistoryByLead = async (req, res) => {
  try {
    const { id } = req.params; // lead_id

    const [rows] = await pool.query(
      `SELECT 
         id,
         lead_id,
         previous_followup_date,
         previous_followup_time,
         previous_followup_reason,
         updated_by_emp_id,
         new_followup_date,
         new_followup_time,
         new_followup_reason,
         department_name,
         DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM followup_history
       WHERE lead_id = ?
       ORDER BY created_at DESC`,
      [id]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ message: `No follow-up history found for Lead ${id}` });
    }

    return res.status(200).json({ lead_id: id, history: rows });
  } catch (error) {
    console.error("Error fetching follow-up history:", error);
    res.status(500).json({ error: "Server error" });
  }
};
