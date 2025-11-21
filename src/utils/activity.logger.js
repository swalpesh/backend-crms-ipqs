import { pool } from "../config/db.js";

export const logActivity = async (lead_id, employee_id, action_type, oldValue, newValue, description) => {
  await pool.query(
    `INSERT INTO lead_activities 
     (lead_id, employee_id, action_type, old_value, new_value, description) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [lead_id, employee_id, action_type, oldValue, newValue, description]
  );
};
