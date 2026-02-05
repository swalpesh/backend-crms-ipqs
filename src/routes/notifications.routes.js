import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { sendNotification, getMyNotifications, markAsRead } from "../controllers/notifications.controller.js";

const router = express.Router();

// POST: Send a Notification
router.post(
  "/send",
  requireAuth, // Any logged-in user can send a notification
  sendNotification
);

// GET: View My Notifications
router.get(
  "/my-notifications",
  requireAuth, 
  getMyNotifications
);

// PATCH: Mark a specific notification as read
router.patch(
  "/:notification_id/read",
  requireAuth,
  markAsRead
);

export default router;