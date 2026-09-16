// ВАЖНО: замените строку ниже на реальный адрес сервера после деплоя на
// Render/Railway (или другой хостинг) — иначе мобильное приложение не сможет
// подключиться к серверу. Один плейсхолдер ниже управляет всеми запросами.
const API_BASE = "https://ЗАМЕНИТЕ-НА-ВАШ-АДРЕС.onrender.com";

(function(){
  "use strict";

  const PATIENT_ID_KEY = "carePatientId_v1";
  const POLL_INTERVAL_MS = 20000;
  const POINTS_PER_COMPLETION = 10;

  const STATE_INFO = {
    "bloom": { icon:"🌸", label:"Цветёт", caption:"Все обязательства выполняются вовремя." },
    "normal": { icon:"🌿", label:"В порядке", caption:"Большая часть дел выполнена." },
    "wilt": { icon:"🍂", label:"Увядает", caption:"Стоит уделить немного внимания." },
    "wilt-severe": { icon:"🥀", label:"Нуждается в заботе", caption:"Несколько дней без ухода — растение это переживёт." }
  };

  const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

  const MOODS = [
    { id:"calm", icon:"😌", label:"Спокойно" },
    { id:"content", icon:"🙂", label:"Хорошо" },
    { id:"tired", icon:"😴", label:"Устало" },
    { id:"stressed", icon:"😣", label:"Напряжённо" },
    { id:"neutral", icon:"😐", label:"Никак" }
  ];

  const GROWTH_LEVELS = [
    { min:0, label:"Семя", icon:"🌰" },
    { min:5, label:"Росток", icon:"🌱" },
    { min:15, label:"Молодое растение", icon:"🌿" },
    { min:30, label:"Крепкое растение", icon:"🪴" },
    { min:60, label:"Раскидистое растение", icon:"🌳" },
    { min:100, label:"Старожил", icon:"🌲" }
  ];

  let lastCompletedId = null;
  let data = null; // cached full state from the server
  let pollTimer = null;

  // ---------- date helpers (local time, avoid UTC-parse day-shift bugs) ----------
  function formatDate(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return y+"-"+m+"-"+day;
  }
  function realTodayStr(){ return formatDate(new Date()); }
  function addDays(dateStr, delta){
    const [y,m,d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m-1, d);
    dt.setDate(dt.getDate()+delta);
    return formatDate(dt);
  }
  function currentDateStr(data){
    return addDays(realTodayStr(), data.virtualOffset || 0);
  }
  function formatDisplayDate(dateStr){
    const [y,m,d] = dateStr.split("-").map(Number);
    return d + " " + MONTHS_GEN[m-1] + " " + y;
  }
  function formatDisplayDateTime(iso){
    try{
      return new Date(iso).toLocaleString("ru-RU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
    }catch(e){ return iso; }
  }
  function pluralDays(n){
    const mod10 = n % 10, mod100 = n % 100;
    if(mod10 === 1 && mod100 !== 11) return "день";
    if(mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "дня";
    return "дней";
  }
  function pluralRu(n, one, few, many){
    const mod10 = n % 10, mod100 = n % 100;
    if(mod10 === 1 && mod100 !== 11) return one;
    if(mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
    return many;
  }

  // ---------- API layer ----------
  async function apiCall(method, path, body){
    const opts = { method };
    if(body !== undefined){
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API_BASE + path, opts);
    let json = null;
    try{ json = await res.json(); }catch(e){ /* no body */ }
    if(!res.ok){
      const err = new Error((json && json.error) || ("HTTP " + res.status));
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function getPatientId(){ return localStorage.getItem(PATIENT_ID_KEY); }
  function setPatientId(id){ localStorage.setItem(PATIENT_ID_KEY, id); }

  // Resolves to true if a patient was loaded/created automatically (existing
  // id, possibly stale -> falls back to a fresh patient). Resolves to false
  // when localStorage was empty from the start, meaning the caller should
  // show the welcome screen (new patient vs. recover-by-code) instead.
  async function ensurePatient(){
    const existingId = getPatientId();
    if(existingId){
      try{
        data = await apiCall("GET", "/api/patients/" + existingId);
        return true;
      }catch(e){
        // stale/unknown id (e.g. server data reset) -> create a fresh patient below
      }
      data = await apiCall("POST", "/api/patients");
      setPatientId(data.id);
      return true;
    }
    return false;
  }

  async function createNewPatient(){
    data = await apiCall("POST", "/api/patients");
    setPatientId(data.id);
  }

  async function recoverPatientByCode(code){
    data = await apiCall("POST", "/api/patients/recover", { recoveryCode: code });
    setPatientId(data.id);
  }

  async function refreshData(){
    data = await apiCall("GET", "/api/patients/" + data.id);
  }

  function getData(){ return data; }

  // ---------- task due/done logic (mirrors server/calc.js) ----------
  const WEEKDAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
  const WEEKDAY_ORDER = ["mon","tue","wed","thu","fri","sat","sun"];
  const WEEKDAY_LABELS = { mon:"Пн", tue:"Вт", wed:"Ср", thu:"Чт", fri:"Пт", sat:"Сб", sun:"Вс" };

  function dowKey(dateStr){
    const [y,m,d] = dateStr.split("-").map(Number);
    return WEEKDAY_KEYS[new Date(y, m-1, d).getDay()];
  }
  function formatWeekdaysShort(arr){
    if(!Array.isArray(arr) || arr.length === 0) return "не выбраны дни";
    return WEEKDAY_ORDER.filter(k => arr.indexOf(k) !== -1).map(k => WEEKDAY_LABELS[k]).join(", ");
  }

  function isPausedOn(task, dateStr){
    if(!Array.isArray(task.pausedRanges)) return false;
    return task.pausedRanges.some(r => dateStr >= r.from && (r.to === null || r.to === undefined || dateStr <= r.to));
  }
  function isTaskCurrentlyPaused(data, task){
    return isPausedOn(task, currentDateStr(data));
  }

  function isDueOn(task, dateStr){
    if(dateStr < task.createdDate) return false;
    if(isPausedOn(task, dateStr)) return false;
    if(task.type === "once") return dateStr === task.createdDate;
    if(task.type === "ongoing") return true;
    if(task.type === "weekday") return Array.isArray(task.weekdays) && task.weekdays.indexOf(dowKey(dateStr)) !== -1;
    if(task.type === "course"){
      const countBefore = task.completions.filter(d => d < dateStr).length;
      return countBefore < task.courseTotal;
    }
    return false;
  }
  function isDoneOn(task, dateStr){
    return task.completions.indexOf(dateStr) !== -1;
  }
  function courseProgress(task){
    return Math.min(task.completions.length, task.courseTotal);
  }
  function isCourseFinished(task){
    return courseProgress(task) >= task.courseTotal;
  }

  function dayStats(data, dateStr){
    let due = 0, done = 0;
    data.tasks.forEach(task => {
      if(isDueOn(task, dateStr)){
        due++;
        if(isDoneOn(task, dateStr)) done++;
      }
    });
    return { due, done };
  }

  function computeHealthPercent(data){
    const today = currentDateStr(data);
    let due = 0, done = 0;
    [0,-1,-2].forEach(off => {
      const s = dayStats(data, addDays(today, off));
      due += s.due; done += s.done;
    });
    if(due === 0) return 100;
    return Math.round(done/due*100);
  }
  function healthState(pct){
    if(pct >= 90) return "bloom";
    if(pct >= 50) return "normal";
    if(pct >= 20) return "wilt";
    return "wilt-severe";
  }

  function computeStreak(data){
    const today = currentDateStr(data);
    let streak = 0;
    const todayStats = dayStats(data, today);
    if(todayStats.due > 0 && todayStats.done >= todayStats.due) streak++;

    let cursor = addDays(today, -1);
    while(true){
      const s = dayStats(data, cursor);
      if(s.due === 0) break;
      if(s.done >= s.due){
        streak++;
        cursor = addDays(cursor, -1);
      }else{
        break;
      }
    }
    return streak;
  }

  function totalCompletions(data){
    return data.tasks.reduce((sum,t) => sum + t.completions.length, 0);
  }
  function growthInfo(total){
    let current = GROWTH_LEVELS[0];
    let next = null;
    for(let i=0;i<GROWTH_LEVELS.length;i++){
      if(total >= GROWTH_LEVELS[i].min) current = GROWTH_LEVELS[i];
      else { next = GROWTH_LEVELS[i]; break; }
    }
    return { current, next };
  }

  function weeklySummaryText(data){
    const today = currentDateStr(data);
    let due = 0, done = 0;
    for(let i=0;i<7;i++){
      const d = addDays(today, -i);
      data.tasks.forEach(t => {
        if(isDueOn(t, d)){
          due++;
          if(isDoneOn(t, d)) done++;
        }
      });
    }
    if(due === 0) return "На этой неделе активных дел не было.";
    const pct = Math.round(done/due*100);
    return "На этой неделе выполнено " + done + " из " + due + " дел (" + pct + "%).";
  }

  function pctBucketClass(due, done){
    if(due === 0) return "heat-none";
    const pct = done/due*100;
    if(pct >= 90) return "heat-4";
    if(pct >= 50) return "heat-3";
    if(pct >= 20) return "heat-2";
    return "heat-1";
  }

  // ---------- rendering: pet screen ----------
  const plantStage = document.getElementById("plantStage");
  const petStatus = document.getElementById("petStatus");
  const petCaption = document.getElementById("petCaption");
  const moodIcon = document.getElementById("moodIcon");
  const moodLabel = document.getElementById("moodLabel");
  const streakLineEl = document.getElementById("streakLine");
  const historyGridEl = document.getElementById("historyGrid");
  const growthLineEl = document.getElementById("growthLine");
  const weekSummaryTextEl = document.getElementById("weekSummaryText");
  const pointsValueTopEl = document.getElementById("pointsValueTop");
  const petNameDisplayEl = document.getElementById("petNameDisplay");

  function renderPetScreen(){
    const data = getData();
    const pct = computeHealthPercent(data);
    const state = healthState(pct);
    const info = STATE_INFO[state];

    petNameDisplayEl.textContent = data.companionName || "Незабудка";

    plantStage.classList.remove("state-bloom","state-normal","state-wilt","state-wilt-severe");
    plantStage.classList.add("state-"+state);

    petStatus.textContent = info.label;
    petCaption.textContent = info.caption;

    moodIcon.textContent = info.icon;
    moodLabel.textContent = info.label;

    pointsValueTopEl.textContent = String(data.points);

    const total = totalCompletions(data);
    const growth = growthInfo(total);
    let growthText = growth.current.icon + " " + growth.current.label + " · " +
      total + " " + pluralRu(total,"поступок","поступка","поступков") + " заботы позади";
    if(growth.next){
      const remaining = growth.next.min - total;
      growthText += " · ещё " + remaining + " " + pluralRu(remaining,"шаг","шага","шагов") + " до «" + growth.next.label + "»";
    }else{
      growthText += " · это самый заметный уровень в этой демо-версии";
    }
    growthLineEl.textContent = growthText;

    weekSummaryTextEl.textContent = weeklySummaryText(data);

    renderStreakAndHistory(data);
  }

  function renderStreakAndHistory(data){
    const today = currentDateStr(data);
    const streak = computeStreak(data);
    streakLineEl.textContent = streak > 0
      ? (streak + " " + pluralDays(streak) + " подряд без пропусков")
      : "Серия начнётся, как только сегодняшние дела будут отмечены.";

    historyGridEl.innerHTML = "";
    for(let i = 13; i >= 0; i--){
      const d = addDays(today, -i);
      const s = dayStats(data, d);
      const cls = pctBucketClass(s.due, s.done);
      const cell = document.createElement("div");
      cell.className = "heat-cell " + cls;
      if(data.journal && data.journal[d]) cell.classList.add("has-note");
      cell.textContent = String(Number(d.split("-")[2]));
      cell.title = formatDisplayDate(d) + (s.due === 0 ? " — задач не было" : " — " + s.done + " из " + s.due + " выполнено");
      cell.addEventListener("click", () => openDayModal(d));
      historyGridEl.appendChild(cell);
    }
  }

  function pulseMood(){
    moodIcon.classList.remove("pulse");
    void moodIcon.offsetWidth;
    moodIcon.classList.add("pulse");
    setTimeout(() => moodIcon.classList.remove("pulse"), 700);
  }

  function reactPlant(){
    const sway = document.getElementById("plantSway");
    sway.classList.remove("reacting");
    void sway.offsetWidth;
    sway.classList.add("reacting");
    setTimeout(() => sway.classList.remove("reacting"), 700);
  }

  function spawnFloatText(anchorEl, text, cls, dx){
    const rect = anchorEl.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = "float-icon " + (cls||"");
    el.textContent = text;
    el.style.left = (rect.left + rect.width/2 - 10 + (dx||0)) + "px";
    el.style.top = (rect.top - 4) + "px";
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add("rise");
    });
    setTimeout(() => el.remove(), 950);
  }
  function spawnFloatIcon(anchorEl){
    spawnFloatText(anchorEl, "🌿", "", 0);
  }

  // ---------- rendering: time machine ----------
  const tmDateEl = document.getElementById("tmDate");
  const tmRealNoteEl = document.getElementById("tmRealNote");
  const tmResetBtn = document.getElementById("tmReset");

  function renderTimeMachine(){
    const data = getData();
    const offset = data.virtualOffset || 0;
    tmDateEl.textContent = formatDisplayDate(currentDateStr(data));
    tmRealNoteEl.textContent = "Реальная дата сегодня: " + formatDisplayDate(realTodayStr());
    tmResetBtn.disabled = offset === 0;
  }

  async function addVirtualDays(n){
    data = await apiCall("POST", "/api/patients/" + data.id + "/time-machine/jump", { days: n });
    renderAll();
  }

  async function resetVirtualDate(){
    if((data.virtualOffset || 0) === 0) return;
    data = await apiCall("POST", "/api/patients/" + data.id + "/time-machine/reset");
    renderAll();
  }

  document.querySelectorAll(".tm-jump").forEach(btn => {
    btn.addEventListener("click", () => addVirtualDays(parseInt(btn.dataset.days, 10)));
  });
  tmResetBtn.addEventListener("click", resetVirtualDate);

  // ---------- rendering: tasks screen ----------
  const taskList = document.getElementById("taskList");
  const emptyState = document.getElementById("emptyState");
  const finishedWrap = document.getElementById("finishedWrap");
  const finishedList = document.getElementById("finishedList");
  const pausedWrap = document.getElementById("pausedWrap");
  const pausedList = document.getElementById("pausedList");
  const otherDaysWrap = document.getElementById("otherDaysWrap");
  const otherDaysList = document.getElementById("otherDaysList");

  function typeSubtitle(task){
    const parts = [];
    if(task.time) parts.push(task.time);
    if(task.type === "once") parts.push("Разово, сегодня");
    else if(task.type === "ongoing") parts.push("Ежедневно");
    else if(task.type === "weekday") parts.push("По дням: " + formatWeekdaysShort(task.weekdays));
    else if(task.type === "course") parts.push("Курс: " + courseProgress(task) + " из " + task.courseTotal + " дней");
    return parts.join(" · ");
  }

  function doctorTagHtml(task){
    if(!task.assignedByDoctorName) return "";
    return " <span class=\"doctor-tag\" title=\"Изначально назначено врачом " + escapeHtml(task.assignedByDoctorName) + "\">Изначально назначено врачом " + escapeHtml(task.assignedByDoctorName) + "</span>";
  }
  function appendDoctorTag(nameEl, task){
    if(!task.assignedByDoctorName) return;
    const tag = document.createElement("span");
    tag.className = "doctor-tag";
    tag.textContent = "Изначально назначено врачом " + task.assignedByDoctorName;
    tag.title = "Эта задача была создана врачом; отметка сохраняется, даже если вы её отредактируете.";
    nameEl.appendChild(tag);
  }

  function renderTasksScreen(){
    const data = getData();
    const today = currentDateStr(data);

    let activeToday = data.tasks.filter(t => isDueOn(t, today));
    activeToday = activeToday.slice().sort((a,b) => {
      const da = isDoneOn(a, today) ? 1 : 0;
      const db = isDoneOn(b, today) ? 1 : 0;
      return da - db;
    });
    const finishedCourses = data.tasks.filter(t => t.type === "course" && isCourseFinished(t) && !isTaskCurrentlyPaused(data, t));
    const pausedTasks = data.tasks.filter(t => isTaskCurrentlyPaused(data, t) && !(t.type === "course" && isCourseFinished(t)));
    const otherDayTasks = data.tasks.filter(t => t.type === "weekday" && !isDueOn(t, today) && !isTaskCurrentlyPaused(data, t));

    taskList.innerHTML = "";
    if(activeToday.length === 0){
      emptyState.classList.remove("hidden");
      emptyState.textContent = data.tasks.length === 0
        ? "На сегодня активных обязательств нет. Здесь будут появляться новые задачи."
        : "На сегодня ничего не запланировано.";
    }else{
      emptyState.classList.add("hidden");
      activeToday.forEach(task => {
        const li = document.createElement("li");
        li.className = "task-card";

        const info = document.createElement("div");
        info.className = "task-info";
        const name = document.createElement("p");
        name.className = "task-name task-name-edit";
        name.textContent = task.name;
        name.title = "Нажмите, чтобы изменить";
        name.addEventListener("click", () => openEditForm(task.id));
        appendDoctorTag(name, task);
        const sub = document.createElement("div");
        sub.className = "task-sub";
        sub.textContent = typeSubtitle(task);
        info.appendChild(name);
        info.appendChild(sub);

        if(task.type === "course"){
          const track = document.createElement("div");
          track.className = "task-progress-track";
          const fill = document.createElement("div");
          fill.className = "task-progress-fill";
          fill.style.width = Math.round(courseProgress(task)/task.courseTotal*100) + "%";
          track.appendChild(fill);
          info.appendChild(track);
        }

        li.appendChild(info);

        const actions = document.createElement("div");
        actions.className = "task-actions";

        const done = isDoneOn(task, today);
        if(done){
          const badge = document.createElement("span");
          badge.className = "badge-done";
          if(task.id === lastCompletedId) badge.classList.add("pop");
          badge.innerHTML = "✓ Сделано";
          actions.appendChild(badge);
        }else{
          const btn = document.createElement("button");
          btn.className = "btn-done";
          btn.type = "button";
          btn.textContent = "Сделал";
          btn.dataset.id = task.id;
          btn.addEventListener("click", onMarkDoneClick);
          actions.appendChild(btn);
        }

        if(task.type === "course"){
          const pauseBtn = document.createElement("button");
          pauseBtn.type = "button";
          pauseBtn.className = "icon-action";
          pauseBtn.title = "Поставить курс на паузу";
          pauseBtn.setAttribute("aria-label", "Поставить курс на паузу");
          pauseBtn.textContent = "⏸";
          pauseBtn.addEventListener("click", () => pauseTask(task.id));
          actions.appendChild(pauseBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-action";
        delBtn.title = "Удалить";
        delBtn.setAttribute("aria-label", "Удалить");
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => deleteTask(task.id));
        actions.appendChild(delBtn);

        li.appendChild(actions);
        taskList.appendChild(li);
      });
    }
    lastCompletedId = null;

    finishedList.innerHTML = "";
    if(finishedCourses.length === 0){
      finishedWrap.classList.add("hidden");
    }else{
      finishedWrap.classList.remove("hidden");
      finishedCourses.forEach(task => {
        const li = document.createElement("li");
        li.className = "finished-card";
        li.innerHTML = "<span class=\"fname\">" + escapeHtml(task.name) + doctorTagHtml(task) + "</span>" +
                        "<span class=\"ftag\">🎉 Завершён · " + task.courseTotal + " дней</span>";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-action";
        delBtn.title = "Удалить";
        delBtn.setAttribute("aria-label", "Удалить");
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => deleteTask(task.id));
        li.appendChild(delBtn);
        finishedList.appendChild(li);
      });
    }

    pausedList.innerHTML = "";
    if(pausedTasks.length === 0){
      pausedWrap.classList.add("hidden");
    }else{
      pausedWrap.classList.remove("hidden");
      pausedTasks.forEach(task => {
        const li = document.createElement("li");
        li.className = "finished-card";
        li.innerHTML = "<span class=\"fname\">" + escapeHtml(task.name) + doctorTagHtml(task) + "</span>" +
                        "<span class=\"ftag\">⏸ На паузе</span>";
        const resumeBtn = document.createElement("button");
        resumeBtn.type = "button";
        resumeBtn.className = "icon-action";
        resumeBtn.title = "Возобновить";
        resumeBtn.setAttribute("aria-label", "Возобновить");
        resumeBtn.textContent = "▶";
        resumeBtn.addEventListener("click", () => resumeTask(task.id));
        li.appendChild(resumeBtn);
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-action";
        delBtn.title = "Удалить";
        delBtn.setAttribute("aria-label", "Удалить");
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => deleteTask(task.id));
        li.appendChild(delBtn);
        pausedList.appendChild(li);
      });
    }

    otherDaysList.innerHTML = "";
    if(otherDayTasks.length === 0){
      otherDaysWrap.classList.add("hidden");
    }else{
      otherDaysWrap.classList.remove("hidden");
      otherDayTasks.forEach(task => {
        const li = document.createElement("li");
        li.className = "finished-card";
        const nameSpan = document.createElement("span");
        nameSpan.className = "fname task-name-edit";
        nameSpan.textContent = task.name;
        nameSpan.title = "Нажмите, чтобы изменить";
        nameSpan.addEventListener("click", () => openEditForm(task.id));
        appendDoctorTag(nameSpan, task);
        const tagSpan = document.createElement("span");
        tagSpan.className = "ftag";
        tagSpan.textContent = typeSubtitle(task);
        li.appendChild(nameSpan);
        li.appendChild(tagSpan);
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-action";
        delBtn.title = "Удалить";
        delBtn.setAttribute("aria-label", "Удалить");
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", () => deleteTask(task.id));
        li.appendChild(delBtn);
        otherDaysList.appendChild(li);
      });
    }
  }

  async function pauseTask(taskId){
    await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + taskId + "/pause");
    await refreshData();
    renderAll();
  }

  async function resumeTask(taskId){
    await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + taskId + "/resume");
    await refreshData();
    renderAll();
  }

  async function deleteTask(taskId){
    const task = data.tasks.find(t => t.id === taskId);
    if(!task) return;
    if(!confirm("Удалить «" + task.name + "»?")) return;
    await apiCall("DELETE", "/api/patients/" + data.id + "/obligations/" + taskId);
    await refreshData();
    renderAll();
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(text){
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function onMarkDoneClick(e){
    const btn = e.currentTarget;
    spawnFloatIcon(btn);
    spawnFloatText(btn, "+" + POINTS_PER_COMPLETION, "float-points", 24);
    pulseMood();
    reactPlant();
    playDoneSound();
    markDone(btn.dataset.id);
  }

  function playDoneSound(){
    const data = getData();
    if(data.soundEnabled === false) return;
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 720;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.38);
      osc.onended = function(){ ctx.close(); };
    }catch(e){}
  }

  async function markDone(taskId){
    let result;
    try{
      result = await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + taskId + "/complete");
    }catch(e){
      return;
    }
    if(result.alreadyDone){
      await refreshData();
      renderAll();
      return;
    }
    lastCompletedId = taskId;
    const justFinished = result.justFinished;
    await refreshData();
    renderAll();
    if(justFinished){
      const task = data.tasks.find(t => t.id === taskId);
      if(task) showCourseCompleteModal(task);
    }
  }

  // ---------- celebration overlay ----------
  const celebrateOverlay = document.getElementById("celebrateOverlay");
  const celebrateTitle = document.getElementById("celebrateTitle");
  const celebrateText = document.getElementById("celebrateText");
  const celebrateCloseBtn = document.getElementById("celebrateClose");

  function showCourseCompleteModal(task){
    celebrateTitle.textContent = "Курс «" + task.name + "» завершён";
    celebrateText.textContent = task.courseTotal + " из " + task.courseTotal + " дней позади. Отличная работа.";
    celebrateOverlay.classList.remove("hidden");
  }
  function hideCelebrateModal(){
    celebrateOverlay.classList.add("hidden");
  }
  celebrateCloseBtn.addEventListener("click", hideCelebrateModal);
  celebrateOverlay.addEventListener("click", (e) => {
    if(e.target === celebrateOverlay) hideCelebrateModal();
  });

  // ---------- tabs ----------
  const tabs = document.querySelectorAll("nav.tabbar button");
  const screens = {
    pet: document.getElementById("screen-pet"),
    tasks: document.getElementById("screen-tasks"),
    rewards: document.getElementById("screen-rewards"),
    journal: document.getElementById("screen-journal")
  };
  function activateTab(tabKey){
    tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabKey));
    Object.keys(screens).forEach(key => screens[key].classList.toggle("active", key === tabKey));
  }
  tabs.forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // ---------- add / edit task form ----------
  const addForm = document.getElementById("addForm");
  const toggleAddFormBtn = document.getElementById("toggleAddForm");
  const cancelAddFormBtn = document.getElementById("cancelAddForm");
  const taskTypeSelect = document.getElementById("taskType");
  const courseDaysWrap = document.getElementById("courseDaysWrap");
  const weekdaysWrap = document.getElementById("weekdaysWrap");
  const weekdayPicker = document.getElementById("weekdayPicker");
  const taskNameInput = document.getElementById("taskName");
  const taskTimeInput = document.getElementById("taskTime");
  const courseDaysInput = document.getElementById("courseDays");
  const editModeTag = document.getElementById("editModeTag");
  const addFormSubmitBtn = document.getElementById("addFormSubmitBtn");

  let editingTaskId = null;

  function getSelectedWeekdays(){
    return Array.prototype.slice.call(weekdayPicker.querySelectorAll("input[type=checkbox]"))
      .filter(cb => cb.checked).map(cb => cb.value);
  }
  function setWeekdayCheckboxes(arr){
    Array.prototype.slice.call(weekdayPicker.querySelectorAll("input[type=checkbox]")).forEach(cb => {
      cb.checked = Array.isArray(arr) && arr.indexOf(cb.value) !== -1;
    });
  }
  function updateFormTypeVisibility(){
    courseDaysWrap.classList.toggle("hidden", taskTypeSelect.value !== "course");
    weekdaysWrap.classList.toggle("hidden", taskTypeSelect.value !== "weekday");
  }

  function openForm(){
    editingTaskId = null;
    editModeTag.classList.add("hidden");
    addFormSubmitBtn.textContent = "Добавить";
    addForm.classList.remove("hidden");
    taskNameInput.focus();
  }
  function closeForm(){
    addForm.classList.add("hidden");
    addForm.reset();
    courseDaysWrap.classList.add("hidden");
    weekdaysWrap.classList.add("hidden");
    editingTaskId = null;
    editModeTag.classList.add("hidden");
    addFormSubmitBtn.textContent = "Добавить";
  }
  function openEditForm(taskId){
    const data = getData();
    const task = data.tasks.find(t => t.id === taskId);
    if(!task) return;
    editingTaskId = taskId;
    taskNameInput.value = task.name;
    taskTypeSelect.value = task.type;
    taskTimeInput.value = task.time || "";
    updateFormTypeVisibility();
    if(task.type === "course") courseDaysInput.value = task.courseTotal;
    setWeekdayCheckboxes(task.weekdays);
    editModeTag.classList.remove("hidden");
    addFormSubmitBtn.textContent = "Сохранить";
    addForm.classList.remove("hidden");
    taskNameInput.focus();
  }

  toggleAddFormBtn.addEventListener("click", () => {
    if(addForm.classList.contains("hidden")) openForm();
    else closeForm();
  });
  cancelAddFormBtn.addEventListener("click", closeForm);

  taskTypeSelect.addEventListener("change", updateFormTypeVisibility);

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = taskNameInput.value.trim();
    if(!name) return;

    const type = taskTypeSelect.value;
    const time = taskTimeInput.value || "";

    if(type === "weekday" && getSelectedWeekdays().length === 0){
      alert("Выберите хотя бы один день недели.");
      return;
    }

    const payload = { name, type, time };
    if(type === "course"){
      const n = parseInt(courseDaysInput.value, 10);
      payload.courseTotal = (n && n > 0) ? n : 7;
    }
    if(type === "weekday") payload.weekdays = getSelectedWeekdays();

    if(editingTaskId){
      await apiCall("PATCH", "/api/patients/" + data.id + "/obligations/" + editingTaskId, payload);
    }else{
      await apiCall("POST", "/api/patients/" + data.id + "/obligations", payload);
    }

    await refreshData();
    closeForm();
    renderAll();
  });

  // ---------- reset demo data ----------
  const resetAllBtn = document.getElementById("resetAllBtn");
  function performFullReset(){
    if(!confirm("Сбросить все данные и начать с нового пациента? Старые данные на сервере не удаляются, но эта вкладка перестанет их видеть.")) return false;
    localStorage.removeItem(PATIENT_ID_KEY);
    location.reload();
    return true;
  }
  resetAllBtn.addEventListener("click", performFullReset);

  // ---------- settings screen ----------
  const settingsOverlay = document.getElementById("settingsOverlay");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const companionNameInput = document.getElementById("companionNameInput");
  const themeToggle = document.getElementById("themeToggle");
  const soundToggle = document.getElementById("soundToggle");
  const exportDataBtn = document.getElementById("exportDataBtn");
  const resetAllSettingsBtn = document.getElementById("resetAllSettingsBtn");

  function applyTheme(theme){
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }

  function openSettings(){
    const data = getData();
    companionNameInput.value = data.companionName || "Незабудка";
    themeToggle.checked = data.theme === "dark";
    soundToggle.checked = data.soundEnabled !== false;
    settingsOverlay.classList.remove("hidden");
  }
  function closeSettings(){
    settingsOverlay.classList.add("hidden");
  }
  openSettingsBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => {
    if(e.target === settingsOverlay) closeSettings();
  });

  companionNameInput.addEventListener("change", async () => {
    const val = companionNameInput.value.trim();
    data = await apiCall("PATCH", "/api/patients/" + data.id, { companionName: val || "Незабудка" });
    renderAll();
  });

  themeToggle.addEventListener("change", async () => {
    data = await apiCall("PATCH", "/api/patients/" + data.id, { theme: themeToggle.checked ? "dark" : "light" });
    applyTheme(data.theme);
  });

  soundToggle.addEventListener("change", async () => {
    data = await apiCall("PATCH", "/api/patients/" + data.id, { soundEnabled: soundToggle.checked });
  });

  exportDataBtn.addEventListener("click", () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "care-companion-data-" + realTodayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  resetAllSettingsBtn.addEventListener("click", () => {
    performFullReset();
  });

  // ---------- shared mood picker ----------
  function buildMoodPicker(container, selectedMood, onSelect){
    container.innerHTML = "";
    MOODS.forEach(m => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mood-opt" + (m.id === selectedMood ? " selected" : "");
      const icon = document.createElement("span");
      icon.textContent = m.icon;
      const label = document.createElement("span");
      label.textContent = m.label;
      b.appendChild(icon);
      b.appendChild(label);
      b.addEventListener("click", () => onSelect(m.id));
      container.appendChild(b);
    });
  }

  // ---------- rewards screen ----------
  const pointsBalanceEl = document.getElementById("pointsBalance");
  const rewardListEl = document.getElementById("rewardList");
  const rewardLogWrapEl = document.getElementById("rewardLogWrap");
  const rewardLogListEl = document.getElementById("rewardLogList");
  const addRewardForm = document.getElementById("addRewardForm");
  const toggleRewardFormBtn = document.getElementById("toggleRewardForm");
  const cancelRewardFormBtn = document.getElementById("cancelRewardForm");
  const rewardNameInput = document.getElementById("rewardName");
  const rewardCostInput = document.getElementById("rewardCost");

  function openRewardForm(){
    addRewardForm.classList.remove("hidden");
    rewardNameInput.focus();
  }
  function closeRewardForm(){
    addRewardForm.classList.add("hidden");
    addRewardForm.reset();
  }
  toggleRewardFormBtn.addEventListener("click", () => {
    if(addRewardForm.classList.contains("hidden")) openRewardForm();
    else closeRewardForm();
  });
  cancelRewardFormBtn.addEventListener("click", closeRewardForm);

  addRewardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = rewardNameInput.value.trim();
    if(!name) return;
    const cost = parseInt(rewardCostInput.value, 10);
    await apiCall("POST", "/api/patients/" + data.id + "/rewards", { name, cost: (cost && cost > 0) ? cost : 20 });
    await refreshData();
    closeRewardForm();
    renderAll();
  });

  async function redeemReward(id, btnEl){
    try{
      data = await apiCall("POST", "/api/patients/" + data.id + "/rewards/" + id + "/redeem");
    }catch(e){
      return;
    }
    if(btnEl) spawnFloatText(btnEl, "✨", "", 0);
    renderAll();
  }

  function renderRewardsScreen(){
    const data = getData();
    pointsBalanceEl.textContent = String(data.points);

    rewardListEl.innerHTML = "";
    data.rewards.forEach(r => {
      const li = document.createElement("li");
      li.className = "reward-card";

      const info = document.createElement("div");
      const name = document.createElement("p");
      name.className = "reward-name";
      name.textContent = r.name;
      const cost = document.createElement("div");
      cost.className = "reward-cost";
      cost.textContent = r.cost + " " + pluralRu(r.cost, "очко", "очка", "очков");
      info.appendChild(name);
      info.appendChild(cost);
      li.appendChild(info);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-redeem";
      if(data.points >= r.cost){
        btn.textContent = "Получить";
        btn.addEventListener("click", () => redeemReward(r.id, btn));
      }else{
        const short = r.cost - data.points;
        btn.textContent = "Ещё " + short + " " + pluralRu(short, "очко", "очка", "очков");
        btn.disabled = true;
      }
      li.appendChild(btn);

      rewardListEl.appendChild(li);
    });

    rewardLogListEl.innerHTML = "";
    const recentLog = data.rewardsLog.slice(-5).reverse();
    if(recentLog.length === 0){
      rewardLogWrapEl.classList.add("hidden");
    }else{
      rewardLogWrapEl.classList.remove("hidden");
      recentLog.forEach(entry => {
        const li = document.createElement("li");
        li.className = "finished-card";
        li.innerHTML = "<span class=\"fname\">" + escapeHtml(entry.name) + "</span>" +
                        "<span class=\"ftag\">✨ -" + entry.cost + " · " + formatDisplayDate(entry.date) + "</span>";
        rewardLogListEl.appendChild(li);
      });
    }
  }

  // ---------- journal screen ----------
  const journalDateLabelEl = document.getElementById("journalDateLabel");
  const moodPickerEl = document.getElementById("moodPicker");
  const journalNoteEl = document.getElementById("journalNote");
  const saveJournalBtn = document.getElementById("saveJournalBtn");
  const journalListEl = document.getElementById("journalList");
  const journalEmptyEl = document.getElementById("journalEmpty");

  let journalPickedMood = null;

  function selectJournalMood(id){
    journalPickedMood = (journalPickedMood === id) ? null : id;
    buildMoodPicker(moodPickerEl, journalPickedMood, selectJournalMood);
  }

  function renderJournalScreen(){
    const data = getData();
    const today = currentDateStr(data);
    journalDateLabelEl.textContent = formatDisplayDate(today);

    const existing = data.journal[today] || null;
    journalPickedMood = existing ? existing.mood : null;
    buildMoodPicker(moodPickerEl, journalPickedMood, selectJournalMood);
    journalNoteEl.value = existing ? (existing.note || "") : "";

    journalListEl.innerHTML = "";
    const dates = Object.keys(data.journal).sort().reverse();
    if(dates.length === 0){
      journalEmptyEl.classList.remove("hidden");
    }else{
      journalEmptyEl.classList.add("hidden");
      dates.forEach(d => {
        const entry = data.journal[d];
        const moodInfo = entry.mood ? MOODS.find(m => m.id === entry.mood) : null;

        const li = document.createElement("li");
        li.className = "journal-card";

        const head = document.createElement("div");
        head.className = "journal-card-head";
        const dateSpan = document.createElement("span");
        dateSpan.textContent = formatDisplayDate(d);
        const moodSpan = document.createElement("span");
        moodSpan.textContent = moodInfo ? (moodInfo.icon + " " + moodInfo.label) : "";
        head.appendChild(dateSpan);
        head.appendChild(moodSpan);

        const note = document.createElement("div");
        note.className = "journal-card-note" + (entry.note ? "" : " empty");
        note.textContent = entry.note ? entry.note : "Без заметки";

        li.appendChild(head);
        li.appendChild(note);
        li.addEventListener("click", () => openDayModal(d));
        journalListEl.appendChild(li);
      });
    }
  }

  saveJournalBtn.addEventListener("click", async () => {
    const today = currentDateStr(data);
    await apiCall("POST", "/api/patients/" + data.id + "/journal", { date: today, mood: journalPickedMood, note: journalNoteEl.value.trim() });
    await refreshData();
    renderAll();
  });

  // ---------- day detail modal (opened from heatmap / journal list) ----------
  const dayModalOverlay = document.getElementById("dayModalOverlay");
  const dayModalDateEl = document.getElementById("dayModalDate");
  const dayModalStatsEl = document.getElementById("dayModalStats");
  const dayModalMoodPickerEl = document.getElementById("dayModalMoodPicker");
  const dayModalNoteEl = document.getElementById("dayModalNote");
  const dayModalCloseBtn = document.getElementById("dayModalClose");
  const dayModalSaveBtn = document.getElementById("dayModalSave");

  let currentModalDate = null;
  let currentModalMood = null;

  function selectModalMood(id){
    currentModalMood = (currentModalMood === id) ? null : id;
    buildMoodPicker(dayModalMoodPickerEl, currentModalMood, selectModalMood);
  }

  function openDayModal(dateStr){
    const data = getData();
    currentModalDate = dateStr;
    dayModalDateEl.textContent = formatDisplayDate(dateStr);
    const s = dayStats(data, dateStr);
    dayModalStatsEl.textContent = s.due === 0
      ? "В этот день дел не было."
      : (s.done + " из " + s.due + " дел отмечено выполненными.");

    const existing = data.journal[dateStr] || null;
    currentModalMood = existing ? existing.mood : null;
    buildMoodPicker(dayModalMoodPickerEl, currentModalMood, selectModalMood);
    dayModalNoteEl.value = existing ? (existing.note || "") : "";

    dayModalOverlay.classList.remove("hidden");
  }
  function closeDayModal(){
    dayModalOverlay.classList.add("hidden");
    currentModalDate = null;
  }
  dayModalCloseBtn.addEventListener("click", closeDayModal);
  dayModalOverlay.addEventListener("click", (e) => {
    if(e.target === dayModalOverlay) closeDayModal();
  });
  dayModalSaveBtn.addEventListener("click", async () => {
    if(!currentModalDate) return;
    await apiCall("POST", "/api/patients/" + data.id + "/journal", { date: currentModalDate, mood: currentModalMood, note: dayModalNoteEl.value.trim() });
    await refreshData();
    closeDayModal();
    renderAll();
  });

  // ---------- connection with doctor ----------
  const connectOverlay = document.getElementById("connectOverlay");
  const openConnectBtn = document.getElementById("openConnectBtn");
  const connectCloseBtn = document.getElementById("connectCloseBtn");
  const connectNoDoctorEl = document.getElementById("connectNoDoctor");
  const connectHasDoctorEl = document.getElementById("connectHasDoctor");
  const pairingCodeDisplayEl = document.getElementById("pairingCodeDisplay");
  const pairingCodeExpiredTagEl = document.getElementById("pairingCodeExpiredTag");
  const copyPairingCodeBtn = document.getElementById("copyPairingCodeBtn");
  const regeneratePairingCodeBtn = document.getElementById("regeneratePairingCodeBtn");
  const connectedDoctorNameEl = document.getElementById("connectedDoctorName");
  const disconnectDoctorBtn = document.getElementById("disconnectDoctorBtn");
  const recoveryCodeDisplayEl = document.getElementById("recoveryCodeDisplay");
  const copyRecoveryCodeBtn = document.getElementById("copyRecoveryCodeBtn");
  const moodDiaryShareToggle = document.getElementById("moodDiaryShareToggle");

  async function copyTextToClipboard(text, btnEl, labelWhenIdle){
    let copied = false;
    try{
      await navigator.clipboard.writeText(text);
      copied = true;
    }catch(e){
      try{
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        copied = true;
      }catch(e2){ copied = false; }
    }
    btnEl.textContent = copied ? "Скопировано!" : "Не удалось скопировать";
    setTimeout(() => { btnEl.textContent = labelWhenIdle; }, 1500);
  }

  function renderConnectOverlay(){
    const data = getData();
    pairingCodeDisplayEl.textContent = data.pairingCode;
    pairingCodeExpiredTagEl.classList.toggle("hidden", !data.pairingCodeExpired);
    recoveryCodeDisplayEl.textContent = data.recoveryCode || "————————";
    moodDiaryShareToggle.checked = !!data.moodDiaryShared;
    if(data.doctor){
      connectNoDoctorEl.classList.add("hidden");
      connectHasDoctorEl.classList.remove("hidden");
      connectedDoctorNameEl.textContent = data.doctor.name;
    }else{
      connectNoDoctorEl.classList.remove("hidden");
      connectHasDoctorEl.classList.add("hidden");
    }
  }

  openConnectBtn.addEventListener("click", () => {
    renderConnectOverlay();
    connectOverlay.classList.remove("hidden");
  });
  connectCloseBtn.addEventListener("click", () => connectOverlay.classList.add("hidden"));
  connectOverlay.addEventListener("click", (e) => {
    if(e.target === connectOverlay) connectOverlay.classList.add("hidden");
  });

  copyPairingCodeBtn.addEventListener("click", () => {
    copyTextToClipboard(data.pairingCode, copyPairingCodeBtn, "Скопировать");
  });

  copyRecoveryCodeBtn.addEventListener("click", () => {
    copyTextToClipboard(data.recoveryCode, copyRecoveryCodeBtn, "Скопировать");
  });

  regeneratePairingCodeBtn.addEventListener("click", async () => {
    if(!confirm("Сгенерировать новый код приглашения? Старый код перестанет работать для новых подключений (уже подключённого врача это не затронет).")) return;
    data = await apiCall("POST", "/api/patients/" + data.id + "/pairing-code/regenerate");
    renderConnectOverlay();
    showToast("Новый код создан");
  });

  moodDiaryShareToggle.addEventListener("change", async () => {
    data = await apiCall("PATCH", "/api/patients/" + data.id, { moodDiaryShared: moodDiaryShareToggle.checked });
    showToast(moodDiaryShareToggle.checked ? "Врач увидит дневник настроения" : "Дневник настроения скрыт от врача");
  });

  disconnectDoctorBtn.addEventListener("click", async () => {
    if(!confirm("Отключить врача? Он больше не будет видеть ваш прогресс, пока вы не поделитесь кодом снова.")) return;
    data = await apiCall("POST", "/api/patients/" + data.id + "/disconnect-doctor");
    renderConnectOverlay();
    renderAll();
  });

  // ---------- schedule update banner ----------
  const scheduleBanner = document.getElementById("scheduleBanner");
  const scheduleBannerText = document.getElementById("scheduleBannerText");
  const scheduleBannerView = document.getElementById("scheduleBannerView");
  const scheduleBannerClose = document.getElementById("scheduleBannerClose");

  function renderBanner(){
    const data = getData();
    const notices = data.notices || [];
    if(notices.length === 0){
      scheduleBanner.classList.add("hidden");
      return;
    }
    scheduleBanner.classList.remove("hidden");
    const latest = notices[notices.length - 1];
    let text = latest.summary;
    if(notices.length > 1){
      const extra = notices.length - 1;
      text += " (и ещё " + extra + " " + pluralRu(extra, "изменение", "изменения", "изменений") + ")";
    }
    scheduleBannerText.textContent = text;
  }

  async function dismissBanner(){
    data = await apiCall("POST", "/api/patients/" + data.id + "/notices/seen");
    renderBanner();
  }
  scheduleBannerClose.addEventListener("click", dismissBanner);
  scheduleBannerView.addEventListener("click", () => {
    activateTab("tasks");
    dismissBanner();
  });

  // ---------- messages from doctor ----------
  const messagesOverlay = document.getElementById("messagesOverlay");
  const openMessagesBtn = document.getElementById("openMessagesBtn");
  const messagesCloseBtn = document.getElementById("messagesCloseBtn");
  const messagesListEl = document.getElementById("messagesList");
  const messagesEmptyEl = document.getElementById("messagesEmpty");
  const messagesBadgeEl = document.getElementById("messagesBadge");

  function renderMessagesList(messages){
    messagesListEl.innerHTML = "";
    if(messages.length === 0){
      messagesEmptyEl.classList.remove("hidden");
      return;
    }
    messagesEmptyEl.classList.add("hidden");
    messages.forEach(m => {
      const card = document.createElement("div");
      card.className = "message-card" + (m.readAt ? "" : " unread");

      const head = document.createElement("div");
      head.className = "message-head";
      const from = document.createElement("span");
      from.textContent = m.doctorName;
      const when = document.createElement("span");
      when.textContent = formatDisplayDateTime(m.createdAt);
      head.appendChild(from);
      head.appendChild(when);

      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = m.text;

      card.appendChild(head);
      card.appendChild(text);

      if(!m.readAt){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "message-mark-read";
        btn.textContent = "Отметить прочитанным";
        btn.addEventListener("click", async () => {
          await apiCall("POST", "/api/patients/" + data.id + "/messages/" + m.id + "/read", {});
          await refreshData();
          renderAll();
          const refreshed = await apiCall("GET", "/api/patients/" + data.id + "/messages");
          renderMessagesList(refreshed);
        });
        card.appendChild(btn);
      }

      messagesListEl.appendChild(card);
    });
  }

  async function openMessages(){
    const messages = await apiCall("GET", "/api/patients/" + data.id + "/messages");
    renderMessagesList(messages);
    messagesOverlay.classList.remove("hidden");
  }
  openMessagesBtn.addEventListener("click", openMessages);
  messagesCloseBtn.addEventListener("click", () => messagesOverlay.classList.add("hidden"));
  messagesOverlay.addEventListener("click", (e) => {
    if(e.target === messagesOverlay) messagesOverlay.classList.add("hidden");
  });

  function renderHeaderBadges(){
    const data = getData();
    const count = data.unreadMessageCount || 0;
    if(count > 0){
      messagesBadgeEl.textContent = count > 9 ? "9+" : String(count);
      messagesBadgeEl.classList.remove("hidden");
    }else{
      messagesBadgeEl.classList.add("hidden");
    }
  }

  // ---------- welcome screen (new device / cleared browser) ----------
  const welcomeOverlay = document.getElementById("welcomeOverlay");
  const welcomeStartNewBtn = document.getElementById("welcomeStartNewBtn");
  const welcomeRecoveryInput = document.getElementById("welcomeRecoveryInput");
  const welcomeRecoveryBtn = document.getElementById("welcomeRecoveryBtn");
  const welcomeRecoveryError = document.getElementById("welcomeRecoveryError");

  function showWelcomeOverlay(){
    welcomeOverlay.classList.remove("hidden");
  }
  function hideWelcomeOverlay(){
    welcomeOverlay.classList.add("hidden");
  }

  async function finishBoot(){
    applyTheme(data.theme);
    renderAll();
    startPolling();
  }

  welcomeStartNewBtn.addEventListener("click", async () => {
    welcomeStartNewBtn.disabled = true;
    try{
      await createNewPatient();
      hideWelcomeOverlay();
      await finishBoot();
    }catch(e){
      welcomeStartNewBtn.disabled = false;
      alert("Не удалось создать нового пациента. Убедитесь, что сервер запущен.");
    }
  });

  welcomeRecoveryBtn.addEventListener("click", async () => {
    welcomeRecoveryError.classList.add("hidden");
    const code = welcomeRecoveryInput.value.trim().toUpperCase();
    if(!code) return;
    welcomeRecoveryBtn.disabled = true;
    try{
      await recoverPatientByCode(code);
      hideWelcomeOverlay();
      await finishBoot();
    }catch(e){
      welcomeRecoveryError.textContent = e.status === 404
        ? "Код не найден. Проверьте, что он введён без ошибок."
        : "Не удалось восстановить доступ.";
      welcomeRecoveryError.classList.remove("hidden");
    }finally{
      welcomeRecoveryBtn.disabled = false;
    }
  });
  welcomeRecoveryInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter") welcomeRecoveryBtn.click();
  });

  // ---------- polling for doctor-side changes ----------
  function startPolling(){
    if(pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try{
        await refreshData();
        renderAll();
      }catch(e){
        // transient network/server error - try again on the next tick
      }
    }, POLL_INTERVAL_MS);
  }

  // ---------- init ----------
  function renderAll(){
    renderPetScreen();
    renderTasksScreen();
    renderTimeMachine();
    renderRewardsScreen();
    renderJournalScreen();
    renderHeaderBadges();
    renderBanner();
  }

  (async function init(){
    let hasPatient;
    try{
      hasPatient = await ensurePatient();
    }catch(e){
      alert("Не удалось подключиться к серверу. Убедитесь, что сервер запущен (npm start), и обновите страницу.");
      return;
    }
    if(!hasPatient){
      showWelcomeOverlay();
      return;
    }
    await finishBoot();
  })();
})();
