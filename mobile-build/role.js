// Role gate shared by the mobile shell's three pages (role.html, index.html =
// patient, doctor.html). The chosen role lives in localStorage, which in the
// Capacitor WebView is shared across all of them (same origin).
//
// Only the patient page ever loads app.js (which owns Local Notifications and
// the time machine), so a doctor never sees those permission prompts: the gate
// below refuses to load it unless the saved role is "patient".
(function(){
  "use strict";
  const ROLE_KEY = "nezabudkaRole_v1";
  const PATIENT_ID_KEY = "carePatientId_v1"; // written by app.js once a patient is registered

  // ROLE_KEY has three distinct states, not two - the role choice is its own
  // flag and must never be re-derived from what other data happens to be on
  // the device:
  //   "patient" / "doctor"  - chosen (explicitly, or migrated once below)
  //   "" (explicit sentinel) - the person asked to choose again ("Сменить
  //                            роль"); never auto-resolve this back to a role
  //                            just because patient/doctor data is still there
  //   absent (key never written) - a pre-role-selection install; here, and
  //                            only here, fall back to the old data-presence
  //                            migration so upgraders don't get asked cold
  function safeGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

  function getRole(){
    const saved = safeGet(ROLE_KEY);
    if(saved === "patient" || saved === "doctor") return saved;
    if(saved === "") return null; // explicitly cleared - always show the picker
    // Key was never written at all: a pre-role-selection install already has
    // patient data on the device - keep it in the patient UI instead of
    // asking "who are you?". Runs once; setRole persists it as a real choice.
    if(safeGet(PATIENT_ID_KEY)){
      setRole("patient");
      return "patient";
    }
    return null;
  }
  function setRole(role){ try{ localStorage.setItem(ROLE_KEY, role); }catch(e){} }
  function clearRole(){ try{ localStorage.setItem(ROLE_KEY, ""); }catch(e){} }

  const PAGE_FOR = { patient: "index.html", doctor: "doctor.html", none: "role.html" };

  // Returns true when this page is the right one for the saved role; otherwise
  // starts a redirect and returns false so the caller skips booting.
  function gate(expected){
    const role = getRole();
    if(role === expected) return true;
    location.replace(PAGE_FOR[role || "none"]);
    return false;
  }

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

  window.NezabudkaRole = { get: getRole, set: setRole, clear: clearRole, gate, switchRole, pageFor: (r) => PAGE_FOR[r] };
})();
