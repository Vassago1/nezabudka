"use strict";

const express = require("express");
const store = require("../store");

const router = express.Router();

// Express 4 doesn't catch rejected promises from async handlers on its own -
// an unhandled rejection would hang the request instead of hitting the error
// middleware in server/index.js.
function h(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const requirePatient = h(async (req, res, next) => {
  const patient = await store.getPatientRow(req.params.id);
  if (!patient) return res.status(404).json({ error: "patient_not_found" });
  req.patientRow = patient;
  next();
});

// Create a new patient (first launch of the patient app in a browser)
router.post(
  "/",
  h(async (req, res) => {
    const id = await store.createPatient();
    res.status(201).json(await store.getFullPatientState(id));
  })
);

// Recover access on a new device / after clearing the browser, using the
// one-time recovery code shown when the patient first connected.
router.post(
  "/recover",
  h(async (req, res) => {
    const code = ((req.body && req.body.recoveryCode) || "").trim();
    if (!code) return res.status(400).json({ error: "recovery_code_required" });
    const patientId = await store.getPatientByRecoveryCode(code);
    if (!patientId) return res.status(404).json({ error: "recovery_code_not_found" });
    res.json(await store.getFullPatientState(patientId));
  })
);

// Deletes a (test) patient and everything tied to them. Disabled by default:
// without ADMIN_KEY set in the environment, this route doesn't exist as far
// as callers can tell.
router.delete(
  "/:id",
  h(async (req, res) => {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) return res.status(404).json({ error: "not_found" });
    const providedKey = req.get("X-Admin-Key");
    if (!providedKey || providedKey !== adminKey) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const ok = await store.deletePatient(req.params.id);
    if (!ok) return res.status(404).json({ error: "patient_not_found" });
    res.json({ ok: true });
  })
);

// Full sync payload: everything the patient UI needs to render
router.get(
  "/:id",
  requirePatient,
  h(async (req, res) => {
    res.json(await store.getFullPatientState(req.params.id));
  })
);

router.patch(
  "/:id",
  requirePatient,
  h(async (req, res) => {
    await store.updatePatientSettings(req.params.id, req.body || {});
    res.json(await store.getFullPatientState(req.params.id));
  })
);

router.post(
  "/:id/time-machine/jump",
  requirePatient,
  h(async (req, res) => {
    const days = parseInt(req.body && req.body.days, 10);
    if (!days) return res.status(400).json({ error: "invalid_days" });
    await store.setVirtualOffset(req.params.id, days);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

router.post(
  "/:id/time-machine/reset",
  requirePatient,
  h(async (req, res) => {
    await store.setVirtualOffset(req.params.id, 0);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

router.post(
  "/:id/disconnect-doctor",
  requirePatient,
  h(async (req, res) => {
    await store.disconnectDoctor(req.params.id);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

// Generates a new pairing code; the old one stops working for new doctor
// connections immediately, but an already-linked doctor is unaffected since
// that link is keyed by patient id, not by the code.
router.post(
  "/:id/pairing-code/regenerate",
  requirePatient,
  h(async (req, res) => {
    await store.regeneratePairingCode(req.params.id);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

router.post(
  "/:id/notices/seen",
  requirePatient,
  h(async (req, res) => {
    await store.markNoticesSeen(req.params.id);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

// ---------- obligations ----------
router.post(
  "/:id/obligations",
  requirePatient,
  h(async (req, res) => {
    const body = req.body || {};
    if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
    const obligation = await store.createObligation(req.params.id, body, null);
    res.status(201).json(obligation);
  })
);

router.patch(
  "/:id/obligations/:oid",
  requirePatient,
  h(async (req, res) => {
    const body = req.body || {};
    if (!body.name || !body.type) return res.status(400).json({ error: "invalid_payload" });
    const obligation = await store.updateObligation(req.params.oid, req.params.id, body, null);
    if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
    res.json(obligation);
  })
);

router.delete(
  "/:id/obligations/:oid",
  requirePatient,
  h(async (req, res) => {
    const ok = await store.deleteObligation(req.params.oid, req.params.id);
    if (!ok) return res.status(404).json({ error: "obligation_not_found" });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/obligations/:oid/complete",
  requirePatient,
  h(async (req, res) => {
    const result = await store.completeObligation(req.params.oid, req.params.id);
    if (!result) return res.status(404).json({ error: "obligation_not_found" });
    res.json(result);
  })
);

router.post(
  "/:id/obligations/:oid/pause",
  requirePatient,
  h(async (req, res) => {
    const obligation = await store.pauseObligation(req.params.oid, req.params.id);
    if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
    res.json(obligation);
  })
);

router.post(
  "/:id/obligations/:oid/resume",
  requirePatient,
  h(async (req, res) => {
    const obligation = await store.resumeObligation(req.params.oid, req.params.id);
    if (!obligation) return res.status(404).json({ error: "obligation_not_found" });
    res.json(obligation);
  })
);

// ---------- journal ----------
router.post(
  "/:id/journal",
  requirePatient,
  h(async (req, res) => {
    const { date, mood, note } = req.body || {};
    if (!date) return res.status(400).json({ error: "invalid_payload" });
    const entry = await store.upsertJournalEntry(req.params.id, date, mood, note);
    res.json({ date, entry });
  })
);

// ---------- rewards ----------
router.post(
  "/:id/rewards",
  requirePatient,
  h(async (req, res) => {
    const { name, cost } = req.body || {};
    if (!name) return res.status(400).json({ error: "invalid_payload" });
    const reward = await store.addReward(req.params.id, name, cost && cost > 0 ? cost : 20);
    res.status(201).json(reward);
  })
);

router.post(
  "/:id/rewards/:rid/redeem",
  requirePatient,
  h(async (req, res) => {
    const result = await store.redeemReward(req.params.id, req.params.rid);
    if (!result) return res.status(404).json({ error: "reward_not_found" });
    if (result.error) return res.status(400).json(result);
    res.json(await store.getFullPatientState(req.params.id));
  })
);

// ---------- messages from doctor ----------
router.get(
  "/:id/messages",
  requirePatient,
  h(async (req, res) => {
    res.json(await store.listMessagesForPatient(req.params.id));
  })
);

router.post(
  "/:id/messages/:mid/read",
  requirePatient,
  h(async (req, res) => {
    const ok = await store.markMessageRead(req.params.mid, req.params.id);
    if (!ok) return res.status(404).json({ error: "message_not_found" });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/messages/read-all",
  requirePatient,
  h(async (req, res) => {
    await store.markAllMessagesRead(req.params.id);
    res.json({ ok: true });
  })
);

module.exports = router;
