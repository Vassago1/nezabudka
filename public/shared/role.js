// Role gate shared by the web app's pages (public/index.html = picker,
// public/patient, public/doctor). The chosen role lives in localStorage,
// scoped to this origin like everything else on these pages.
//
// Unlike the mobile shell (mobile-build/role.js, three local pages in one
// WebView), /patient and /doctor here are separate, independently bookmarked
// URLs that already worked before role selection existed - so this module
// does NOT redirect someone away from /patient or /doctor just because a
// different role is stored (that would break existing bookmarks and shared
// registration links). The stored role only decides two things: what "/"
// shows, and where "Сменить роль" sends you back to.
(function(){
  "use strict";
  const ROLE_KEY = "nezabudkaRole_v1";
  const PATIENT_ID_KEY = "carePatientId_v1"; // written by /patient once a patient is registered
  const DOCTOR_ID_KEY = "careDoctorId_v1";   // written by /doctor once a doctor logs in

  // ROLE_KEY has three distinct states, not two - the role choice is its own
  // flag and must never be re-derived from what other data happens to be on
  // the device:
  //   "patient" / "doctor"  - chosen (explicitly, or migrated once below)
  //   "" (explicit sentinel) - the person asked to choose again ("Сменить
  //                            роль"); never auto-resolve this back to a role
  //                            just because patient/doctor data is still there
  //   absent (key never written) - a pre-role-selection visit to this origin;
  //                            here, and only here, fall back to the old
  //                            data-presence migration so existing patients/
  //                            doctors don't get asked "who are you?" cold
  function safeGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

  function getRole(){
    const saved = safeGet(ROLE_KEY);
    if(saved === "patient" || saved === "doctor") return saved;
    if(saved === "") return null; // explicitly cleared - always show the picker
    if(safeGet(PATIENT_ID_KEY)){ setRole("patient"); return "patient"; }
    if(safeGet(DOCTOR_ID_KEY)){ setRole("doctor"); return "doctor"; }
    return null;
  }
  function setRole(role){ try{ localStorage.setItem(ROLE_KEY, role); }catch(e){} }
  function clearRole(){ try{ localStorage.setItem(ROLE_KEY, ""); }catch(e){} }

  const PAGE_FOR = { patient: "/patient", doctor: "/doctor", none: "/" };

  function switchRole(){
    const ok = confirm("Сменить роль? Ваши данные сохранятся, вы вернётесь на экран выбора.");
    if(!ok) return;
    clearRole();
    location.href = PAGE_FOR.none;
  }

  // Any element with id="switchRoleBtn" (patient settings, doctor header) is wired up here.
  function bindSwitchButton(){
    const btn = document.getElementById("switchRoleBtn");
    if(btn) btn.addEventListener("click", switchRole);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindSwitchButton);
  else bindSwitchButton();

  window.NezabudkaRole = { get: getRole, set: setRole, clear: clearRole, switchRole, pageFor: (r) => PAGE_FOR[r] };
})();
