"use strict";

const express = require("express");
const store = require("../store");

const router = express.Router();

function getBearerToken(req) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

// Verifies the session token from the Authorization header, and that it
// belongs to the doctor named in the URL - every /doctor API call is
// checked this way, not just login.
function requireDoctorSession(req, res, next) {
  const token = getBearerToken(req);
  const doctor = store.getDoctorBySessionToken(token);
  if (!doctor || doctor.id !== req.params.id) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.doctorRow = doctor;
  next();
}

// Single endpoint for both first-time registration and later logins: a new
// name creates the doctor account with this password; an existing name
// requires the password to match.
router.post("/login", (req, res) => {
  const name = (req.body && req.body.name || "").trim();
  const password = (req.body && req.body.password || "");
  if (!name) return res.status(400).json({ error: "name_required" });
  if (!password) return res.status(400).json({ error: "password_required" });
  const result = store.loginOrRegisterDoctor(name, password);
  if (result.error === "invalid_password") {
    return res.status(401).json({ error: "invalid_password" });
  }
  res.status(201).json(result);
});

router.get("/:id", requireDoctorSession, (req, res) => {
  res.json({ id: req.doctorRow.id, name: req.doctorRow.name });
});

router.get("/:id/patients", requireDoctorSession, (req, res) => {
  res.json(store.getDoctorPatientsSummary(req.params.id));
});

router.get("/:id/notices", requireDoctorSession, (req, res) => {
  res.json(store.listDoctorNotices(req.params.id));
});

router.post("/:id/notices/seen", requireDoctorSession, (req, res) => {
  store.markDoctorNoticesSeen(req.params.id);
  res.json({ ok: true });
});

router.post("/:id/patients", requireDoctorSession, (req, res) => {
  const code = (req.body && req.body.pairingCode || "").trim();
  if (!code) return res.status(400).json({ error: "pairing_code_required" });
  const result = store.linkPatientByCode(req.params.id, code);
  if (result.error === "not_found") return res.status(404).json({ error: "pairing_code_not_found" });
  if (result.error === "expired") return res.status(410).json({ error: "pairing_code_expired" });
  if (result.error === "already_linked") return res.status(409).json({ error: "already_linked_to_another_doctor" });
  res.status(201).json({ patientId: result.patientId });
});

router.get("/:id/patients/:pid", requireDoctorSession, (req, res) => {
  const detail = store.getPatientDetailForDoctor(req.params.id, req.params.pid);
  if (detail.error === "not_linked") return res.status(403).json({ error: "not_linked" });
  if (detail.error === "not_found") return res.status(404).json({ error: "patient_not_found" });
  res.json(detail);
});

router.post("/:id/patients/:pid/obligations", requireDoctorSession, (req, res) => {
  if (!store.isDoctorLinkedToPatient(req.params.id, req.params.pid)) {
    return res.status(403).json({ error: "not_linked" });
  }
  const body = req.body || {};
  if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
  const obligation = store.createObligation(req.params.pid, body, {
    id: req.doctorRow.id,
    name: req.doctorRow.name,
  });
  res.status(201).json(obligation);
});

router.patch("/:id/patients/:pid/obligations/:oid", requireDoctorSession, (req, res) => {
  if (!store.isDoctorLinkedToPatient(req.params.id, req.params.pid)) {
    return res.status(403).json({ error: "not_linked" });
  }
  const body = req.body || {};
  if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
  const obligation = store.updateObligation(req.params.oid, req.params.pid, body, {
    id: req.doctorRow.id,
    name: req.doctorRow.name,
  });
  if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
  res.json(obligation);
});

router.delete("/:id/patients/:pid/obligations/:oid", requireDoctorSession, (req, res) => {
  if (!store.isDoctorLinkedToPatient(req.params.id, req.params.pid)) {
    return res.status(403).json({ error: "not_linked" });
  }
  const ok = store.deleteObligation(req.params.oid, req.params.pid, {
    id: req.doctorRow.id,
    name: req.doctorRow.name,
  });
  if (!ok) return res.status(404).json({ error: "obligation_not_found" });
  res.json({ ok: true });
});

router.post("/:id/patients/:pid/messages", requireDoctorSession, (req, res) => {
  const text = (req.body && req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "text_required" });
  const result = store.sendDoctorMessage(req.params.id, req.params.pid, text);
  if (result.error === "not_linked") return res.status(403).json({ error: "not_linked" });
  res.status(201).json(result);
});

module.exports = router;
