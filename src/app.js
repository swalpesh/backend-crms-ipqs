// src/server.js
import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

/* ---------------------------- Import Routes ---------------------------- */
import superAdminRoutes from "./routes/superAdmin.routes.js";
import departmentRoutes from "./routes/departments.routes.js";
import roleRoutes from "./routes/roles.routes.js";
import employeeRoutes from "./routes/employees.routes.js";
import companyRoutes from "./routes/companies.routes.js";
import contactsRoutes from "./routes/contacts.routes.js";
import quotationRoutes from "./routes/quotations.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import leadRoutes from "./routes/leads.routes.js";
import fieldleadRoutes from "./routes/fieldleads.routes.js";
import associateleadRoutes from "./routes/associateleads.routes.js";
import corporateleadRoutes from "./routes/corporateleads.routes.js";
import TechnicalleadRoutes from "./routes/technicalteamleads.routes.js";
import SolutionsleadRoutes from "./routes/solutionsteamleads.routes.js";

/* ------------------------------ Config ------------------------------ */
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

/* ---------------------------- CORS Settings --------------------------- */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow all origins (Postman, browser, etc.)
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  exposedHeaders: ["Content-Length", "X-Kuma-Revision"],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

/* ------------------------- Preflight Handling ------------------------- */
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, X-Requested-With"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return res.sendStatus(204);
  }
  next();
});

/* ---------------------------- Static Serving --------------------------- */
// ✅ Serve uploads folder (important for images/docs)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ✅ Optional: Route to force file download if needed
app.get("/download/:folder/:filename", (req, res) => {
  const { folder, filename } = req.params;
  const filePath = path.join(process.cwd(), "uploads", folder, filename);

  res.download(filePath, (err) => {
    if (err) {
      console.error("Error downloading file:", err);
      res.status(404).json({ message: "File not found" });
    }
  });
});

/* ------------------------------ Routes ------------------------------ */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "ipqs-crm-backend",
    time: new Date().toISOString(),
  });
});

app.use("/api/v1/superadmin", superAdminRoutes);
app.use("/api/v1/departments", departmentRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/employees", employeeRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1/contacts", contactsRoutes);
app.use("/api/v1/quotations", quotationRoutes);
app.use("/api/v1/payments", paymentsRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/fleads", fieldleadRoutes);
app.use("/api/aleads", associateleadRoutes);
app.use("/api/cleads", corporateleadRoutes);
app.use("/api/tleads", TechnicalleadRoutes);
app.use("/api/sleads", SolutionsleadRoutes);

/* ----------------------------- Error Handler ----------------------------- */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (err?.message?.includes("CORS"))
    return res.status(403).json({ message: "CORS error: Origin not allowed" });
  res.status(500).json({ message: "Internal server error" });
});

/* ------------------------------- Server ------------------------------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ IPQS CRM backend listening on port ${PORT}`);
  console.log(`🌐 CORS: allowing all origins (dev mode).`);
  console.log(`📂 Static files served from: http://localhost:${PORT}/uploads`);
});
