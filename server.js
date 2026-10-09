import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174"
  ]
}));
app.use(express.json());

const { MONGODB_URI, APP_PASSWORD, PORT = 5000 } = process.env;
if (!MONGODB_URI || !APP_PASSWORD) {
  console.error("Missing MONGODB_URI or APP_PASSWORD environment variable.");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
console.log("Connected to MongoDB");

const entrySchema = new mongoose.Schema({
  date: { type: String, required: true },
  type: { type: String, enum: ["sale", "stock"], required: true },
  token: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
  rate: { type: Number, required: true, min: 0 },
  supplier: { type: String, default: "" },
  customer: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Entry = mongoose.model("Entry", entrySchema);

// Lightweight shared-password gate for this single-user starter.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  const provided = req.header("x-app-password");
  if (provided !== APP_PASSWORD) return res.status(401).json({ message: "Invalid app password" });
  next();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/entries", async (req, res) => {
  try {
    const filter = {};
    if (["sale", "stock"].includes(req.query.type)) filter.type = req.query.type;
    const entries = await Entry.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    res.json(entries);
  } catch (err) { res.status(500).json({ message: "Could not load entries" }); }
});

app.post("/api/entries", async (req, res) => {
  try {
    const { date, type, token, quantity, rate, supplier = "", customer = "" } = req.body;
    if (!date || !["sale", "stock"].includes(type) || !String(token || "").trim()) {
      return res.status(400).json({ message: "Date, type, and token/product are required." });
    }
    const qty = Number(quantity), unitRate = Number(rate);
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(unitRate) || unitRate < 0) {
      return res.status(400).json({ message: "Quantity must be a positive whole number and rate must be zero or more." });
    }
    const entry = await Entry.create({ date, type, token: token.trim(), quantity: qty, rate: unitRate, supplier: String(supplier).trim(), customer: String(customer).trim() });
    res.status(201).json(entry);
  } catch (err) { res.status(500).json({ message: "Could not save entry" }); }
});

app.delete("/api/entries/:id", async (req, res) => {
  try {
    const deleted = await Entry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Entry not found" });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ message: "Invalid entry ID" }); }
});

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
