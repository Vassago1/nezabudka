"use strict";

const path = require("node:path");
const express = require("express");
const cors = require("cors");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch (e) {
  // .env is optional - fall back to PORT from the real environment, or the default below.
}

const { migrate } = require("./migrate");
const patientRoutes = require("./routes/patient");
const doctorRoutes = require("./routes/doctor");

const app = express();
// The Android app (Capacitor WebView) calls this API from a different origin
// (https://localhost by default) than the browser-served /patient and /doctor
// pages, so cross-origin requests need explicit CORS headers. No cookies are
// used for auth (doctor sessions are a bearer token), so allowing all
// origins here doesn't expose any credentialed state.
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/patients", patientRoutes);
app.use("/api/doctors", doctorRoutes);

app.use("/patient", express.static(path.join(__dirname, "..", "public", "patient")));
app.use("/doctor", express.static(path.join(__dirname, "..", "public", "doctor")));

app.get("/patient", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "patient", "index.html"));
});
app.get("/doctor", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "doctor", "index.html"));
});
app.get("/", (req, res) => {
  res.redirect("/patient");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Care companion server listening on http://localhost:" + PORT);
      console.log(
        process.env.DATABASE_URL
          ? "Storage: Postgres (DATABASE_URL)"
          : "Storage: local SQLite file (data.sqlite)"
      );
    });
  })
  .catch((err) => {
    console.error("Database migration failed, server not started:", err);
    process.exit(1);
  });
