"use strict";

const express = require("express");
const store = require("../store");

const router = express.Router();

function requirePatient(req, res, next) {
  const patient = store.getPatientRow(req.params.id);
  if (!patient) return res.status(404).json({ error: "patient_not_found" });
  req.patientRow = patient;
  next();
}

// Create a new patient (first launch of the patient app in a browser)
router.post("/", (req, res) => {
  const id = store.createPatient();
  res.status(201).json(store.getFullPatientState(id));
});

// Recover access on a new device / after clearing the browser, using the
// one-time recovery code shown when the patient first connected.
router.post("/recover", (req, res) => {
  const code = (req.body && req.body.recoveryCode || "").trim();
  if (!code) return res.status(400).json({ error: "recovery_code_required" });
  const patientId = store.getPatientByRecoveryCode(code);
  if (!patientId) return res.status(404).json({ error: "recovery_code_not_found" });
  res.json(store.getFullPatientState(patientId));
});

// Full sync payload: everything the patient UI needs to render
router.get("/:id", requirePatient, (req, res) => {
  res.json(store.getFullPatientState(req.params.id));
});

router.patch("/:id", requirePatient, (req, res) => {
  store.updatePatientSettings(req.params.id, req.body || {});
  res.json(store.getFullPatientState(req.params.id));
});

router.post("/:id/time-machine/jump", requirePatient, (req, res) => {
  const days = parseInt(req.body && req.body.days, 10);
  if (!days) return res.status(400).json({ error: "invalid_days" });
  store.setVirtualOffset(req.params.id, days);
  res.json(store.getFullPatientState(req.params.id));
});

router.post("/:id/time-machine/reset", requirePatient, (req, res) => {
  store.setVirtualOffset(req.params.id, 0);
  res.json(store.getFullPatientState(req.params.id));
});

router.post("/:id/disconnect-doctor", requirePatient, (req, res) => {
  store.disconnectDoctor(req.params.id);
  res.json(store.getFullPatientState(req.params.id));
});

// Generates a new pairing code; the old one stops working for new doctor
// connections immediately, but an already-linked doctor is unaffected since
// that link is keyed by patient id, not by the code.
router.post("/:id/pairing-code/regenerate", requirePatient, (req, res) => {
  store.regeneratePairingCode(req.params.id);
  res.json(store.getFullPatientState(req.params.id));
});

router.post("/:id/notices/seen", requirePatient, (req, res) => {
  store.markNoticesSeen(req.params.id);
  res.json(store.getFullPatientState(req.params.id));
});

// ---------- obligations ----------
router.post("/:id/obligations", requirePatient, (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
  const obligation = store.createObligation(req.params.id, body, null);
  res.status(201).json(obligation);
});

router.patch("/:id/obligations/:oid", requirePatient, (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
  const obligation = store.updateObligation(req.params.oid, req.params.id, body, null);
  if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
  res.json(obligation);
});

router.delete("/:id/obligations/:oid", requirePatient, (req, res) => {
  const ok = store.deleteObligation(req.params.oid, req.params.id);
  if (!ok) return res.status(404).json({ error: "obligation_not_found" });
  res.json({ ok: true });
});

router.post("/:id/obligations/:oid/complete", requirePatient, (req, res) => {
  const result = store.completeObligation(req.params.oid, req.params.id);
  if (!result) return res.status(404).json({ error: "obligation_not_found" });
  res.json(result);
});

router.post("/:id/obligations/:oid/pause", requirePatient, (req, res) => {
  const obligation = store.pauseObligation(req.params.oid, req.params.id);
  if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
  res.json(obligation);
});

router.post("/:id/obligations/:oid/resume", requirePatient, (req, res) => {
  const obligation = store.resumeObligation(req.params.oid, req.params.id);
  if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
  res.json(obligation);
});

// ---------- journal ----------
router.post("/:id/journal", requirePatient, (req, res) => {
  const { date, mood, note } = req.body || {};
  if (!date) return res.status(400).json({ error: "invalid_payload" });
  const entry = store.upsertJournalEntry(req.params.id, date, mood, note);
  res.json({ date, entry });
});

// ---------- rewards ----------
router.post("/:id/rewards", requirePatient, (req, res) => {
  const { name, cost } = req.body || {};
  if (!name) return res.status(400).json({ error: "invalid_payload" });
  const reward = store.addReward(req.params.id, name, cost && cost > 0 ? cost : 20);
  res.status(201).json(reward);
});

router.post("/:id/rewards/:rid/redeem", requirePatient, (req, res) => {
  const result = store.redeemReward(req.params.id, req.params.rid);
  if (!result) return res.status(404).json({ error: "reward_not_found" });
  if (result.error) return res.status(400).json(result);
  res.json(store.getFullPatientState(req.params.id));
});

// ---------- messages from doctor ----------
router.get("/:id/messages", requirePatient, (req, res) => {
  res.json(store.listMessagesForPatient(req.params.id));
});

router.post("/:id/messages/:mid/read", requirePatient, (req, res) => {
  const ok = store.markMessageRead(req.params.mid, req.params.id);
  if (!ok) return res.status(404).json({ error: "message_not_found" });
  res.json({ ok: true });
});

router.post("/:id/messages/read-all", requirePatient, (req, res) => {
  store.markAllMessagesRead(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
