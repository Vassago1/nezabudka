"use strict";

const crypto = require("node:crypto");

function randomId(prefix) {
  return prefix + "-" + Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
}

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

function randomCodeFromAlphabet(length) {
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}

function randomPairingCode() {
  return randomCodeFromAlphabet(6);
}

function randomRecoveryCode() {
  return randomCodeFromAlphabet(8);
}

function randomSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { randomId, randomPairingCode, randomRecoveryCode, randomSessionToken };
