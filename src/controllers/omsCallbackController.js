import { pool } from "../config/db.js";

export const submitITCallbackRequest = async (req, res) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      message,
      requestCallback,
    } = req.body;

    /* ---------------- REQUIRED VALIDATION ---------------- */
    if (!fullName || !phoneNumber || !email) {
      return res.status(400).json({
        success: false,
        message: "Full Name, Phone Number and Email are required",
      });
    }

    /* ---------------- EMAIL VALIDATION ---------------- */
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    /* ---------------- INSERT QUERY ---------------- */
    const query = `
      INSERT INTO oms_callback_requests
      (
        full_name,
        phone_number,
        email,
        message,
        request_callback
      )
      VALUES (?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      fullName,
      phoneNumber,
      email,
      message || null,
      requestCallback !== undefined ? requestCallback : true,
    ]);

    return res.status(201).json({
      success: true,
      message: "OMS-IOT Callback request submitted successfully",
    });
  } catch (error) {
    console.error("OMS Request Callback Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
