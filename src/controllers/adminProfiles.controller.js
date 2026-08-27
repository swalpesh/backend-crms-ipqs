import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* 1. CREATE PROFILE API (Secured: Requires Main Admin Account Login)        */
/* -------------------------------------------------------------------------- */
export const createAdminProfile = async (req, res) => {
  try {
    const { profile_name, password } = req.body;
    const employeeId = req.user.employee_id; // Taken from your requireAuth middleware

    // Basic Validation
    if (!profile_name || !password) {
      return res.status(400).json({ error: "profile_name and password are required." });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters long." });
    }

    // Hash the profile password securely
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert the new profile into the database
    const [result] = await pool.query(
      `INSERT INTO admin_profiles (employee_id, profile_name, profile_password_hash) 
       VALUES (?, ?, ?)`,
      [employeeId, profile_name, passwordHash]
    );

    return res.status(201).json({
      message: "Admin profile created successfully.",
      profile: {
        profile_id: result.insertId,
        employee_id: employeeId,
        profile_name,
        is_active: "Yes"
      }
    });

  } catch (error) {
    console.error("Error creating admin profile:", error);
    res.status(500).json({ error: "Server error while creating profile." });
  }
};

/* -------------------------------------------------------------------------- */
/* 2. PROFILE LOGIN API (Verifies Profile Password & Generates Profile Token) */
/* -------------------------------------------------------------------------- */
export const loginAdminProfile = async (req, res) => {
  try {
    const { profile_id, password } = req.body;
    const employeeId = req.user.employee_id; // Taken from your requireAuth middleware

    // Basic Validation
    if (!profile_id || !password) {
      return res.status(400).json({ error: "profile_id and password are required." });
    }

    // Fetch the profile and make sure it belongs to the logged-in employee
    const [profiles] = await pool.query(
      `SELECT * FROM admin_profiles 
       WHERE profile_id = ? AND employee_id = ? AND is_active = 'Yes'`,
      [profile_id, employeeId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({ error: "Profile not found or is currently inactive." });
    }

    const profile = profiles[0];

    // Verify the profile password match
    const isMatch = await bcrypt.compare(password, profile.profile_password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid profile password." });
    }

    // Generate a fresh, profile-specific JWT session token
    // This allows your frontend to know exactly which profile context is active
    const profileToken = jwt.sign(
      { 
        employee_id: profile.employee_id, 
        role_id: req.user.role_id, // Keep the original auth_role
        active_profile_id: profile.profile_id,
        active_profile_name: profile.profile_name
      },
      process.env.JWT_SECRET || "your_jwt_secret_key",
      { expiresIn: "8h" }
    );

    return res.status(200).json({
      message: `Switched context to profile: ${profile.profile_name}`,
      profile_token: profileToken,
      profile: {
        profile_id: profile.profile_id,
        profile_name: profile.profile_name
      }
    });

  } catch (error) {
    console.error("Error logging into profile:", error);
    res.status(500).json({ error: "Server error during profile login." });
  }
};

/* -------------------------------------------------------------------------- */
/* 4. GET ALL PROFILES FOR THE LOGGED-IN EMPLOYEE                             */
/* -------------------------------------------------------------------------- */
export const getAllAdminProfiles = async (req, res) => {
  try {
    // Grab the main employee ID from the verified JWT token
    const employeeId = req.user.employee_id;

    // Fetch the profiles and JOIN with the employees table to get dept & role
    const [profiles] = await pool.query(
      `SELECT 
        p.profile_id, 
        p.employee_id, 
        p.profile_name, 
        p.is_active, 
        p.created_at, 
        p.updated_at,
        e.department_id,
        e.role_id AS department_role
       FROM admin_profiles p
       INNER JOIN employees e ON p.employee_id = e.employee_id
       WHERE p.employee_id = ? 
       ORDER BY p.created_at ASC`,
      [employeeId]
    );

    // Return Success
    return res.status(200).json({
      message: "Profiles fetched successfully.",
      total_profiles: profiles.length,
      data: profiles
    });

  } catch (error) {
    console.error("Error fetching admin profiles:", error);
    res.status(500).json({ error: "Server error while fetching profiles." });
  }
};


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


/* -------------------------------- Create Admin Lead -------------------------------- */
export const createLead = async (req, res) => {
  try {
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
      reason, // <-- Extracted from React payload
      
      lead_type,
      lead_priority,
      expected_closing_date,
      expected_revenue,
      probability,
      mark_as_hot_lead
    } = req.body;

    // 🔥 DIAGNOSTIC LOG: Check your backend terminal when you click "Save Lead"
    console.log("=== CREATING ADMIN LEAD ===");
    console.log("RECEIVED REASON:", reason);

    const lead_id = await generateLeadId();
    
    // Safely extract the creator's ID
    const created_by = req.user?.employee_id || req.admin?.employee_id || req.profile?.employee_id || "Admin";

    // 1. Insert new lead
    await pool.query(
      `INSERT INTO leads 
      (
        lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
        company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
        industry_type, lead_requirement, notes, status, assigned_employee, created_by, lead_status,
        follow_up_reason, follow_up_date, follow_up_time, lead_stage,
        lead_type, lead_priority, expected_closing_date, expected_revenue, probability, mark_as_hot_lead
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 'active', ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )`,
      [
        lead_id, lead_name, company_name, contact_person_name, contact_person_phone, contact_person_email,
        company_contact_number, company_email, company_website, company_address, company_country, company_state, company_city, zipcode,
        industry_type, lead_requirement, notes, assigned_employee || "0", created_by, lead_status || "new",
        lead_status === "follow-up" ? follow_up_reason : null,
        lead_status === "follow-up" ? follow_up_date : null,
        lead_status === "follow-up" ? follow_up_time : null,
        lead_stage || "IpqsHead", lead_type || null, lead_priority || "Medium", expected_closing_date || null,
        expected_revenue || 0.00, probability || 0, mark_as_hot_lead ? 1 : 0
      ]
    );

    // ✅ 2. NUCLEAR OVERRIDE: Defeat Database Triggers
    const customReason = reason || 'New Lead Created';
    
    // First, try to UPDATE the row in case a MySQL Trigger automatically created it
    const [updateResult] = await pool.query(
      `UPDATE lead_activity_backup 
       SET reason = ?, changed_by = ?, change_type = 'Lead Created' 
       WHERE lead_id = ?`,
      [customReason, created_by, lead_id]
    );

    // If no rows were updated (meaning no trigger exists), insert it manually
    if (updateResult.affectedRows === 0) {
      await pool.query(
        `INSERT INTO lead_activity_backup 
        (lead_id, new_lead_stage, new_assigned_employee, reason, changed_by, change_type, change_timestamp)
        VALUES (?, ?, ?, ?, ?, 'Lead Created', CURRENT_TIMESTAMP)`,
        [
          lead_id, 
          lead_stage || "IpqsHead", 
          assigned_employee || "0",
          customReason, 
          created_by
        ]
      );
    }

    // 3. Return response
    return res.status(201).json({ 
      message: "Lead created successfully", 
      lead_id 
    });

  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ error: "Server error" });
  }
};