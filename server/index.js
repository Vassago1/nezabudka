"use strict";

const path = require("node:path");
const express = require("express");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch (e) {
  // .env is optional - fall back to PORT from the real environment, or the default below.
}

const patientRoutes = require("./routes/patient");
const doctorRoutes = require("./routes/doctor");

const app = express();
app.use(express.json());

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
app.listen(PORT, () => {
  console.log("Care companion server listening on http://localhost:" + PORT);
});
