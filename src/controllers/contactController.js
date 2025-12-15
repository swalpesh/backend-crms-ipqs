import { pool } from "../config/db.js";

export const submitContactForm = async (req, res) => {
  try {
    const {
      fullName,
      mobileNumber,
      email,
      plantType,
      plantAddress,
      systemRequirement,
    } = req.body;

    /* ---------------- REQUIRED FIELD VALIDATION ---------------- */
    if (!fullName || !mobileNumber || !email || !plantAddress) {
      return res.status(400).json({
        success: false,
        message:
          "Full Name, Mobile Number, Email Address, and Plant Address are required",
      });
    }

    /* ---------------- OPTIONAL VALIDATIONS ---------------- */
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    if (mobileNumber.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid mobile number",
      });
    }

    /* ---------------- MYSQL INSERT ---------------- */
    const insertQuery = `
      INSERT INTO contact_requests
      (
        full_name,
        mobile_number,
        email,
        plant_address,
        plant_type,
        system_requirement
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await pool.query(insertQuery, [
      fullName,
      mobileNumber,
      email,
      plantAddress,
      plantType ? JSON.stringify(plantType) : null,
      systemRequirement ? JSON.stringify(systemRequirement) : null,
    ]);

    /* ---------------- SUCCESS RESPONSE ---------------- */
    return res.status(201).json({
      success: true,
      message: "Contact form submitted successfully",
    });
  } catch (error) {
    console.error("Contact Form Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
