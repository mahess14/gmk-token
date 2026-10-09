import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const {
  MONGODB_URI,
  APP_PASSWORD,
  PORT = 5000,
  FRONTEND_ORIGIN = ""
} = process.env;

// Allow local development and your configured Netlify website.
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  ...FRONTEND_ORIGIN.split(",").map((url) => url.trim()).filter(Boolean)
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header, such as health checks.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("CORS blocked origin:", origin);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-app-password"],
    optionsSuccessStatus: 204
  })
);

app.use(express.json());

// Check required environment variables.
if (!MONGODB_URI || !APP_PASSWORD) {
  console.error(
    "Missing MONGODB_URI or APP_PASSWORD environment variable."
  );
  process.exit(1);
}

// Entry schema.
const entrySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    type: {
      type: String,
      enum: ["sale", "stock"],
      required: true
    },
    token: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    rate: { type: Number, required: true, min: 0 },
    supplier: { type: String, default: "" },
    customer: { type: String, default: "" }
  },
  { timestamps: true }
);

const Entry = mongoose.model("Entry", entrySchema);

// Public health endpoint; other API routes require the app password.
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

// Password protection.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();

  const provided = req.get("x-app-password");

  if (provided !== APP_PASSWORD) {
    return res.status(401).json({
      message: "Invalid app password"
    });
  }

  next();
});

// Get entries.
app.get("/api/entries", async (req, res) => {
  try {
    const filter = {};

    if (["sale", "stock"].includes(req.query.type)) {
      filter.type = req.query.type;
    }

    const entries = await Entry.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .lean();

    res.json(entries);
  } catch (error) {
    console.error("Load entries error:", error);
    res.status(500).json({ message: "Could not load entries" });
  }
});

// Create an entry.
app.post("/api/entries", async (req, res) => {
  try {
    const {
      date,
      type,
      token,
      quantity,
      rate,
      supplier = "",
      customer = ""
    } = req.body;

    if (!date || !["sale", "stock"].includes(type) ||
        !String(token || "").trim()) {
      return res.status(400).json({
        message: "Date, type, and token/product are required."
      });
    }

    const qty = Number(quantity);
    const unitRate = Number(rate);

    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      !Number.isFinite(unitRate) ||
      unitRate < 0
    ) {
      return res.status(400).json({
        message: "Quantity must be a positive whole number and rate must be zero or more."
      });
    }

    const entry = await Entry.create({
      date,
      type,
      token: String(token).trim(),
      quantity: qty,
      rate: unitRate,
      supplier: String(supplier).trim(),
      customer: String(customer).trim()
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error("Create entry error:", error);
    res.status(500).json({ message: "Could not save entry" });
  }
});

// Delete an entry.
app.delete("/api/entries/:id", async (req, res) => {
  try {
    const deleted = await Entry.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Entry not found" });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete entry error:", error);
    res.status(400).json({ message: "Invalid entry ID" });
  }
});

// Log errors, including unexpected CORS failures.
app.use((error, req, res, next) => {
  console.error("Request error:", error.message);

  if (res.headersSent) return next(error);

  res.status(500).json({ message: error.message || "Internal server error" });
});

// Connect to MongoDB, then start the server.
try {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on port ${PORT}`);
    console.log("Allowed frontend origins:", allowedOrigins);
  });
} catch (error) {
  console.error("Startup/MongoDB error:", error.message);
  process.exit(1);
}