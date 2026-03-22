// src/controllers/employees.controller.js
import { pool } from "../config/db.js";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

function mapEmployeeRow(r) {
  return {
    employee_id: r.employee_id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    dob: r.dob, // YYYY-MM-DD
    contact_number: r.contact_number,
    address: r.address,
    username: r.username,
    department_id: r.department_id,
    department_name: r.department_name,
    role_id: r.role_id,
    role_name: r.role_name,
    location: r.location,
    status: r.status,            // ✅ include status
    created_at: r.created_at,
    has_photo: r.photo != null && r.photo.length > 0
  };
}

// POST /api/v1/employees  (multipart/form-data)
export const createEmployee = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    if (!req.file) return res.status(400).json({ message: "photo is required" });
    const photoBuf = req.file.buffer;
    const photoMime = req.file.mimetype;

    const {
      employee_id,
      first_name,
      last_name,
      email,
      dob, // "YYYY-MM-DD"
      contact_number,
      address,
      username,
      password,
      confirm_password,          // ⚠️ stored plaintext per spec
      department_id,
      role_id,
      location,
      status = "active"          // ✅ new
    } = req.body;

    if (!["active", "inactive"].includes(status.trim()))
      return res.status(400).json({ message: "status must be 'active' or 'inactive'" });

    if (password !== confirm_password)
      return res.status(400).json({ message: "password and confirm_password must match" });

    // Uniqueness checks
    const [[idRow]] = await pool.query(`SELECT COUNT(*) AS c FROM employees WHERE employee_id = ?`, [employee_id]);
    if (idRow.c) return res.status(409).json({ message: "employee_id already exists" });

    const [[emailRow]] = await pool.query(`SELECT COUNT(*) AS c FROM employees WHERE email = ?`, [email.toLowerCase().trim()]);
    if (emailRow.c) return res.status(409).json({ message: "email already exists" });

    const [[userRow]] = await pool.query(`SELECT COUNT(*) AS c FROM employees WHERE username = ?`, [username.trim()]);
    if (userRow.c) return res.status(409).json({ message: "username already exists" });

    // Validate department & role (and match)
    const [depRows] = await pool.query(
      `SELECT department_id, department_name FROM departments WHERE department_id = ? LIMIT 1`,
      [department_id.trim()]
    );
    if (!depRows.length) return res.status(400).json({ message: "Invalid department_id" });

    const [roleRows] = await pool.query(
      `SELECT role_id, role_name, department_id FROM roles WHERE role_id = ? LIMIT 1`,
      [role_id.trim()]
    );
    if (!roleRows.length) return res.status(400).json({ message: "Invalid role_id" });
    if (roleRows[0].department_id !== depRows[0].department_id)
      return res.status(400).json({ message: "role does not belong to the given department" });

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query(
      `INSERT INTO employees (
        employee_id, first_name, last_name, photo, photo_mime, email, dob,
        contact_number, address, username, password_hash, confirm_password_plain,
        department_id, role_id, location, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id.trim(),
        first_name.trim(),
        last_name.trim(),
        photoBuf,
        photoMime,
        email.toLowerCase().trim(),
        dob,
        contact_number ? contact_number.trim() : null,
        address ? address.trim() : null,
        username.trim(),
        password_hash,
        confirm_password,                    // ⚠️ plaintext by spec
        department_id.trim(),
        role_id.trim(),
        location ? location.trim() : null,
        status.trim()                        // ✅ store status
      ]
    );

    const [rows] = await pool.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.dob, e.contact_number, e.address,
              e.username, e.department_id, e.role_id, e.location, e.status, e.created_at, e.photo,
              d.department_name, r.role_name
       FROM employees e
       JOIN departments d ON d.department_id = e.department_id
       JOIN roles r ON r.role_id = e.role_id
       WHERE e.employee_id = ?`,
      [employee_id.trim()]
    );

    return res.status(201).json({ message: "Employee created", data: mapEmployeeRow(rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to create employee" });
  }
};


// GET /api/v1/employees
export const listEmployees = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.dob, e.contact_number, e.address,
              e.username, e.department_id, e.role_id, e.location, e.created_at, e.photo, e.status,
              d.department_name, r.role_name
       FROM employees e
       JOIN departments d ON d.department_id = e.department_id
       JOIN roles r ON r.role_id = e.role_id
       ORDER BY e.created_at DESC`
    );
    return res.json({ data: rows.map(mapEmployeeRow) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/v1/employees/:id
export const getEmployee = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [rows] = await pool.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.dob, e.contact_number, e.address,
              e.username, e.department_id, e.role_id, e.location, e.created_at, e.photo, e.status,
              d.department_name, r.role_name
       FROM employees e
       JOIN departments d ON d.department_id = e.department_id
       JOIN roles r ON r.role_id = e.role_id
       WHERE e.employee_id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json({ data: mapEmployeeRow(rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/v1/employees/:id/photo  (binary)
export const getEmployeePhoto = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [rows] = await pool.query(
      `SELECT photo, photo_mime FROM employees WHERE employee_id = ?`,
      [id]
    );
    if (!rows.length || !rows[0].photo) return res.status(404).json({ message: "No photo" });
    res.setHeader("Content-Type", rows[0].photo_mime || "application/octet-stream");
    return res.send(rows[0].photo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};

// PATCH /api/v1/employees/:id  (multipart/form-data allowed)
export const updateEmployee = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();

    const [exist] = await pool.query(`SELECT employee_id FROM employees WHERE employee_id = ?`, [id]);
    if (!exist.length) return res.status(404).json({ message: "Not found" });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const sets = [];
    const args = [];
    const s = (k, v) => { sets.push(`${k} = ?`); args.push(v); };
    const b = req.body;

    if (b.first_name) s("first_name", b.first_name.trim());
    if (b.last_name) s("last_name", b.last_name.trim());
    if (b.email) {
      const [[eRow]] = await pool.query(
        `SELECT COUNT(*) AS c FROM employees WHERE email = ? AND employee_id <> ?`,
        [b.email.toLowerCase().trim(), id]
      );
      if (eRow.c) return res.status(409).json({ message: "email already exists" });
      s("email", b.email.toLowerCase().trim());
    }
    if (b.dob) s("dob", b.dob);
    if (b.contact_number) s("contact_number", b.contact_number.trim());
    if (b.address) s("address", b.address.trim());
    if (b.username) {
      const [[uRow]] = await pool.query(
        `SELECT COUNT(*) AS c FROM employees WHERE username = ? AND employee_id <> ?`,
        [b.username.trim(), id]
      );
      if (uRow.c) return res.status(409).json({ message: "username already exists" });
      s("username", b.username.trim());
    }

    // password change
    if (b.password || b.confirm_password) {
      if (!b.password || !b.confirm_password)
        return res.status(400).json({ message: "Both password and confirm_password required to change password" });
      if (b.password !== b.confirm_password)
        return res.status(400).json({ message: "password and confirm_password must match" });

      const hash = await bcrypt.hash(b.password, SALT_ROUNDS);
      s("password_hash", hash);
      s("confirm_password_plain", b.confirm_password); // ⚠️ per spec
    }

    if (b.department_id) {
      const [dep] = await pool.query(
        `SELECT department_id FROM departments WHERE department_id = ?`,
        [b.department_id.trim()]
      );
      if (!dep.length) return res.status(400).json({ message: "Invalid department_id" });
      s("department_id", b.department_id.trim());
    }
    if (b.role_id) {
      const [rl] = await pool.query(
        `SELECT role_id, department_id FROM roles WHERE role_id = ?`,
        [b.role_id.trim()]
      );
      if (!rl.length) return res.status(400).json({ message: "Invalid role_id" });

      // Ensure department consistency
      let targetDept = b.department_id ? b.department_id.trim() : null;
      if (!targetDept) {
        const [[cur]] = await pool.query(`SELECT department_id FROM employees WHERE employee_id = ?`, [id]);
        targetDept = cur?.department_id;
      }
      if (rl[0].department_id !== targetDept)
        return res.status(400).json({ message: "role does not belong to the given department" });

      s("role_id", b.role_id.trim());
    }
    if (b.location) s("location", b.location.trim());

    // ✅ status update
    if (typeof b.status === "string") {
      const st = b.status.trim();
      if (!["active", "inactive"].includes(st))
        return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
      s("status", st);
    }

    // photo update
    if (req.file) {
      s("photo", req.file.buffer);
      s("photo_mime", req.file.mimetype);
    }

    if (!sets.length) return res.status(400).json({ message: "No fields to update" });

    args.push(id);
    await pool.query(`UPDATE employees SET ${sets.join(", ")} WHERE employee_id = ?`, args);

    const [rows] = await pool.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.dob, e.contact_number, e.address,
              e.username, e.department_id, e.role_id, e.location, e.status, e.created_at, e.photo,
              d.department_name, r.role_name
       FROM employees e
       JOIN departments d ON d.department_id = e.department_id
       JOIN roles r ON r.role_id = e.role_id
       WHERE e.employee_id = ?`,
      [id]
    );
    return res.json({ message: "Updated", data: mapEmployeeRow(rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to update employee" });
  }
};


// DELETE /api/v1/employees/:id
export const deleteEmployee = async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    const [result] = await pool.query(`DELETE FROM employees WHERE employee_id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
};


/* -------------------------------------------------------------------------- */
/* UPDATE EMPLOYEE IN_TRIP STATUS                                             */
/* -------------------------------------------------------------------------- */
export const updateInTripStatus = async (req, res) => {
  try {
    const { in_trip } = req.body;
    
    // Default to updating the logged-in user, unless an explicit employee_id is provided
    const targetEmployeeId = req.body.employee_id || req.user.employee_id;

    // 1. Validation
    if (!targetEmployeeId) {
      return res.status(400).json({ error: "Employee ID is missing." });
    }

    if (!["Yes", "No"].includes(in_trip)) {
      return res.status(400).json({ 
        error: "Invalid value. in_trip must be strictly 'Yes' or 'No'." 
      });
    }

    // 2. Execute the Update
    const [result] = await pool.query(
      `UPDATE employees 
       SET in_trip = ?, 
           updated_at = NOW() 
       WHERE employee_id = ?`,
      [in_trip, targetEmployeeId]
    );

    // 3. Check if the employee exists
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }

    // 4. Success Response
    return res.status(200).json({
      message: `Trip status for ${targetEmployeeId} successfully updated to '${in_trip}'.`,
      data: {
        employee_id: targetEmployeeId,
        in_trip: in_trip
      }
    });

  } catch (error) {
    console.error("Error updating in_trip status:", error);
    res.status(500).json({ error: "Server error while updating trip status." });
  }
};


/* -------------------------------------------------------------------------- */
/* GET ALL FIELD MARKETING EMPLOYEES                                          */
/* -------------------------------------------------------------------------- */
export const getFieldMarketingEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Field-Marketing' if your exact database string is different 
    // (e.g., 'Field Marketing' with a space)
    const targetDepartment = 'Field-Marketing';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Field Marketing.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Field Marketing employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Field Marketing employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET ALL ASSOCIATE MARKETING EMPLOYEES                                     */
/* -------------------------------------------------------------------------- */
export const getAssociateMarketingEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Field-Marketing' if your exact database string is different 
    // (e.g., 'Field Marketing' with a space)
    const targetDepartment = 'Associate-Marketing';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Associate Marketing.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Associate Marketing employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Associate Marketing employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET ALL CORPORATE MARKETING EMPLOYEES                                     */
/* -------------------------------------------------------------------------- */
export const getCorporateMarketingEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Corporate-Marketing' if your exact database string is different 
    // (e.g., 'Corporate Marketing' with a space)
    const targetDepartment = 'Corporate-Marketing';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Corporate Marketing.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Corporate Marketing employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Corporate Marketing employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET ALL TECHNICAL TEAM EMPLOYEES                                          */
/* -------------------------------------------------------------------------- */
export const getTechnicalTeamEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Technical-Team' if your exact database string is different 
    // (e.g., 'Technical Team' with a space)
    const targetDepartment = 'Technical-Team';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Technical Team.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Technical Team employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Technical Team employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET ALL SOLUTION TEAM EMPLOYEES                                          */
/* -------------------------------------------------------------------------- */
export const getSolutionTeamEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Solution-Team' if your exact database string is different 
    // (e.g., 'Solution Team' with a space)
    const targetDepartment = 'Solutions-Team';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Solutions Team.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Solutions Team employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Solutions Team employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET ALL QUOTATION TEAM EMPLOYEES                                          */
/* -------------------------------------------------------------------------- */
export const getQuotationTeamEmployees = async (req, res) => {
  try {
    // Note: Adjust 'Quotation-Team' if your exact database string is different 
    // (e.g., 'Quotation Team' with a space)
    const targetDepartment = 'Quotation-Team';

    const [employees] = await pool.query(
      `SELECT 
        employee_id, 
        first_name, 
        last_name, 
        email, 
        contact_number, 
        role_id, 
        location,
        in_trip,
        status 
       FROM employees 
       WHERE department_id = ? AND status = 'active'
       ORDER BY first_name ASC`,
      [targetDepartment]
    );

    if (employees.length === 0) {
      return res.status(200).json({
        message: "No active employees found in Quotation Team.",
        total: 0,
        data: []
      });
    }

    return res.status(200).json({
      message: "Quotation Team employees fetched successfully.",
      total: employees.length,
      data: employees
    });

  } catch (error) {
    console.error("Error fetching Quotation Team employees:", error);
    res.status(500).json({ error: "Server error while fetching employees." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET LOGGED-IN EMPLOYEE'S TRIP STATUS                                       */
/* -------------------------------------------------------------------------- */
export const getMyTripStatus = async (req, res) => {
  try {
    const employeeId = req.user.employee_id;

    // Fetch only the in_trip status for the specific employee
    const [[employee]] = await pool.query(
      `SELECT in_trip FROM employees WHERE employee_id = ?`,
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee record not found." });
    }

    return res.status(200).json({
      message: "Trip status fetched successfully.",
      employee_id: employeeId,
      in_trip: employee.in_trip // Will return 'Yes' or 'No' (or whatever your ENUM is)
    });

  } catch (error) {
    console.error("Error fetching trip status:", error);
    res.status(500).json({ error: "Server error while fetching trip status." });
  }
};