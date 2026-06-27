import { pool } from "../config/db.js";

/* -------------------------------------------------------------------------- */
/* POST: SUBMIT CONSULTATION FORM (Used by the Static Website)                */
/* -------------------------------------------------------------------------- */
export const submitConsultationRequest = async (req, res) => {
  try {
    const { 
      customer_type, 
      full_name, 
      phone_number, 
      email_address, 
      pincode, 
      avg_bill 
    } = req.body;

    // Grab the uploaded file path if the user attached an electricity bill
    const electricityBillPath = req.file ? req.file.path : null;

    // 1. Basic Validation (Require the mandatory fields)
    if (!full_name || !phone_number || !email_address || !pincode) {
      return res.status(400).json({ 
        error: "Full Name, Phone Number, Email, and Pincode are required." 
      });
    }

    // 2. Insert into the solar_consultation_requests table
    const [result] = await pool.query(
      `INSERT INTO solar_consultation_requests 
       (customer_type, full_name, phone_number, email_address, pincode, avg_bill, electricity_bill_path) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_type || 'Residential', 
        full_name, 
        phone_number, 
        email_address, 
        pincode, 
        avg_bill || 0, 
        electricityBillPath
      ]
    );

    // 3. Return Success
    return res.status(201).json({
      message: "Consultation booked successfully. Our experts will contact you soon!",
      request_id: result.insertId
    });

  } catch (error) {
    console.error("Error submitting consultation:", error);
    res.status(500).json({ error: "Server error while submitting your request." });
  }
};

/* -------------------------------------------------------------------------- */
/* GET: FETCH ALL CONSULTATIONS (Used by the CRM Dashboard)                   */
/* -------------------------------------------------------------------------- */
export const getConsultationRequests = async (req, res) => {
  try {
    const { status } = req.query;
    
    // Fetch from the solar_consultation_requests table
    let query = `SELECT * FROM solar_consultation_requests`;
    const params = [];

    if (status) {
      query += ` WHERE status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const [requests] = await pool.query(query, params);

    return res.status(200).json({
      message: "Consultation requests fetched successfully.",
      total: requests.length,
      data: requests
    });

  } catch (error) {
    console.error("Error fetching consultations:", error);
    res.status(500).json({ error: "Server error while fetching requests." });
  }
};