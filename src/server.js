const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../prod.env") });
require("./utils/cron");

const connectDB = require("./db");

const app = express();
const PORT = process.env.PORT || 5555;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "50mb";

const defaultAllowedOrigins = [
  "https://glazia.in",
  "https://www.glazia.in",
  "https://quotation.glazia.in",
  "https://glazia-quotation.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "https://splendid-begonia-cbc292.netlify.app",
];

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || defaultAllowedOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.set("trust proxy", 1);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json({ extended: false, limit: JSON_BODY_LIMIT }));

connectDB();

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/admin-form");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/user", userRoutes);
app.use("/api/profile", profileRoutes);

app.get("/", (req, res) => {
  res.send("Glazia main backend is running");
});

app.get("/health", (req, res) => {
  res.json({ service: "backend-main", ok: true });
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large" });
  }

  return next(error);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Glazia main backend running on http://localhost:${PORT}`);
});
