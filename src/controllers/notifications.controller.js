import { pool } from "../config/db.js";

/* ---------------- Helper: Generate Custom ID ---------------- */
function generateNotificationId() {
  const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
  return `NOT-IPQS-${randomNum}`;
}

/* ---------------- Create Notification (Send) ---------------- */
export const sendNotification = async (req, res) => {
  try {
    const { to_emp_id, title, message } = req.body;
    const from_emp_id = req.user.employee_id; // Sender is the logged-in user

    // ✅ Validation
    if (!to_emp_id || !title || !message) {
      return res.status(400).json({ 
        error: "Recipient (to_emp_id), title, and message are required." 
      });
    }

    // ✅ Generate Unique ID
    let notification_id = generateNotificationId();
    
    // Safety check for ID collision
    let [existing] = await pool.query("SELECT 1 FROM notifications WHERE notification_id = ?", [notification_id]);
    while (existing.length > 0) {
      notification_id = generateNotificationId();
      [existing] = await pool.query("SELECT 1 FROM notifications WHERE notification_id = ?", [notification_id]);
    }

    // ✅ Insert into Database
    await pool.query(
      `INSERT INTO notifications 
      (notification_id, from_emp_id, to_emp_id, title, message, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, FALSE, NOW())`,
      [notification_id, from_emp_id, to_emp_id, title, message]
    );

    res.status(201).json({
      message: "Notification sent successfully.",
      notification_id,
      from: from_emp_id,
      to: to_emp_id
    });

  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ error: "Server error" });
  }
};


/* ---------------- Get My Notifications (Today Only) ---------------- */
export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.employee_id;

    // ✅ Query: Get notifications sent TO this user AND created TODAY
    const query = `
      SELECT 
        n.*,
        e.first_name, 
        e.last_name, 
        e.username
      FROM notifications n
      LEFT JOIN employees e 
        ON n.from_emp_id COLLATE utf8mb4_unicode_ci = e.employee_id COLLATE utf8mb4_unicode_ci
      WHERE n.to_emp_id = ? 
      AND DATE(n.created_at) = CURDATE()  -- 👈 Filters for TODAY only
      ORDER BY n.created_at DESC
    `;

    const [rows] = await pool.query(query, [userId]);

    // ✅ Process Data
    const notifications = rows.map(row => {
      const formatted = {
        ...row,
        sender_name: (row.first_name && row.last_name) 
          ? `${row.first_name} ${row.last_name}` 
          : row.username
      };
      
      delete formatted.first_name;
      delete formatted.last_name;
      delete formatted.username;
      
      return formatted;
    });

    res.status(200).json({
      message: "Today's notifications fetched successfully",
      date: new Date().toISOString().split('T')[0], // Shows current date
      total: notifications.length,
      data: notifications
    });

  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/* ---------------- Mark Notification as Read ---------------- */
export const markAsRead = async (req, res) => {
  try {
    const { notification_id } = req.params;
    const userId = req.user.employee_id;

    // ✅ Update Query: Only if the notification belongs to this user
    const [result] = await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE notification_id = ? AND to_emp_id = ?",
      [notification_id, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Notification not found or access denied." });
    }

    res.status(200).json({ message: "Notification marked as read." });

  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ error: "Server error" });
  }
};