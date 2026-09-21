#!/usr/bin/env node
// Generates mobile-build/doctor.html and mobile-build/report.html from the web
// doctor panel (public/doctor/), so the web version stays the single source of
// truth and the mobile copy can be regenerated after any change to it:
//   node scripts/build-mobile-doctor.js        (or: npm run mobile:doctor)
//
// Differences from the web pages, all applied as asserted string replacements
// (a failed match aborts, so upstream drift can't silently produce a broken copy):
//  - API calls go to the real Render server (API_BASE) instead of a relative path,
//    the same address app.js uses for the patient side
//  - the main script only boots when the saved role is "doctor" (role.js gate)
//  - a "Сменить роль" button in the header
//  - the report opens in the same WebView (no window.open/window.close there)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_BASE = 'https://nezabudka-zzaa.onrender.com'; // keep in sync with mobile-build/app.js

function replaceOnce(src, from, to, label) {
  const idx = src.indexOf(from);
  if (idx === -1 || src.indexOf(from, idx + 1) !== -1) {
    throw new Error(`build-mobile-doctor: expected exactly one match for "${label}"`);
  }
  return src.replace(from, () => to);
}

// The web pages may be checked out with CRLF; the replacements below match LF.
function readLf(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function buildDoctor() {
  let s = readLf('public/doctor/index.html');
  s = replaceOnce(s, '<title>', '<title>', 'title'); // sanity: page has a title
  s = replaceOnce(s, 'const res = await fetch(path, opts);', 'const res = await fetch(API_BASE + path, opts);', 'apiCall fetch');
  s = replaceOnce(s, '  const DOCTOR_ID_KEY = "careDoctorId_v1";',
    `  const API_BASE = "${API_BASE}";\n  const DOCTOR_ID_KEY = "careDoctorId_v1";`, 'DOCTOR_ID_KEY');
  s = replaceOnce(s, 'window.open("/doctor/report.html?patientId=" + encodeURIComponent(currentPatientId), "_blank");',
    'location.href = "report.html?patientId=" + encodeURIComponent(currentPatientId);', 'report link');
  s = replaceOnce(s, '      <button type="button" class="btn-ghost hidden" id="logoutBtn"',
    '      <button type="button" class="btn-ghost" id="switchRoleBtn" style="padding:6px 12px;font-size:12.5px;">Сменить роль</button>\n      <button type="button" class="btn-ghost hidden" id="logoutBtn"', 'header buttons');
  // Main script: park it as inert text and only run it once the role gate passes.
  s = replaceOnce(s, '<script>\n(function(){\n  "use strict";\n',
    '<script src="role.js"></script>\n<script type="text/plain" id="doctorMain">\n(function(){\n  "use strict";\n', 'main script open');
  s = replaceOnce(s, '</script>\n</body>',
    `</script>
<script>
  // Refuse to boot (and so never touch the network) unless this device's role is "doctor".
  (function(){
    if(!NezabudkaRole.gate("doctor")) return;
    var s = document.createElement("script");
    s.textContent = document.getElementById("doctorMain").textContent;
    document.body.appendChild(s);
  })();
</script>
</body>`, 'main script close');
  return s;
}

function buildReport() {
  let s = readLf('public/doctor/report.html');
  s = replaceOnce(s, 'const res = await fetch("/api/doctors/"', `const res = await fetch("${API_BASE}" + "/api/doctors/"`, 'report fetch');
  s = replaceOnce(s, '{ window.close(); location.href = "/doctor"; }', '{ location.href = "doctor.html"; }', 'back button');
  return s;
}

fs.writeFileSync(path.join(ROOT, 'mobile-build/doctor.html'), buildDoctor());
fs.writeFileSync(path.join(ROOT, 'mobile-build/report.html'), buildReport());
console.log('wrote mobile-build/doctor.html and mobile-build/report.html');
