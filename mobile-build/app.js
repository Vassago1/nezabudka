// ВАЖНО: замените строку ниже на реальный адрес сервера после деплоя на
// Render/Railway (или другой хостинг) — иначе мобильное приложение не сможет
// подключиться к серверу. Один плейсхолдер ниже управляет всеми запросами.
const API_BASE = "https://nezabudka-zzaa.onrender.com";

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
  // Same 4 health tiers, worded for a companion that isn't a plant (no
  // "blooms"/"wilts") - used whenever the active species' kind isn't "plant".
  const STATE_INFO_ANIMAL = {
    "bloom": { icon:"✨", label:"Отлично", caption:"Все обязательства выполняются вовремя." },
    "normal": { icon:"🙂", label:"Хорошо", caption:"Большая часть дел выполнена." },
    "wilt": { icon:"😌", label:"Вяло", caption:"Стоит уделить немного внимания." },
    "wilt-severe": { icon:"😴", label:"Совсем вяло", caption:"Несколько дней без ухода — компаньон немного грустит, но справится." }
  };
  // Species that render from a photo per health state instead of the SVG
  // rig, keyed by species id (not kind/shape - e.g. the default plant's
  // shape is shared with a gold reward species that must keep the SVG
  // rig). Species not listed here still use the SVG rig untouched -
  // currently that's every plant species except the default one.
  const PHOTO_STATE_FILES = {
    "cat_default": {
      "bloom": "img/cat-great.webp",
      "normal": "img/cat-good.webp",
      "wilt": "img/cat-low.webp",
      "wilt-severe": "img/cat-verylow.webp"
    },
    "dog_default": {
      "bloom": "img/dog-great.webp",
      "normal": "img/dog-good.webp",
      "wilt": "img/dog-low.webp",
      "wilt-severe": "img/dog-verylow.webp"
    },
    "default": {
      "bloom": "img/plant-great.webp",
      "normal": "img/plant-good.webp",
      "wilt": "img/plant-low.webp",
      "wilt-severe": "img/plant-verylow.webp"
    }
  };
  function stateInfoFor(state, kind){
    return (kind && kind !== "plant" ? STATE_INFO_ANIMAL : STATE_INFO)[state];
  }

  // ---------- collection: species, scenes, achievements (ids must match server/catalog.js) ----------
  const SPECIES_CATALOG = [
    { id:"default", kind:"plant", name:"Незабудка", icon:"🌸", desc:"Ваше стартовое растение", cost:0, rare:false, shape:"default",
      palette:{ leafFrom:"#8FAE79", leafTo:"#557141", potFrom:"#D59C6E", potTo:"#B4784F", petal:"#E9A9C2", petalAlt:"#D5B9DE", center:"#F6E7B8" } },
    { id:"fern", kind:"plant", name:"Папоротник", icon:"🌿", desc:"Раскидистые резные ветки, никогда не цветёт", cost:55, rare:false, shape:"fern",
      palette:{ leafFrom:"#7FAE6E", leafTo:"#3F6E38", potFrom:"#C9A277", potTo:"#A47C52" } },
    { id:"cactus", kind:"plant", name:"Кактус", icon:"🌵", desc:"Колючий, но цветёт ярче всех, когда всё хорошо", cost:70, rare:false, shape:"cactus",
      palette:{ leafFrom:"#7FB06B", leafTo:"#4C7A3A", potFrom:"#C9A277", potTo:"#A47C52" } },
    { id:"ivy", kind:"plant", name:"Плющ", icon:"🍃", desc:"Свисающие вниз плети, горшок на подвесной полке", cost:65, rare:false, shape:"ivy",
      palette:{ leafFrom:"#6FAE7A", leafTo:"#3D7A4C", potFrom:"#B49CC9", potTo:"#8D6FAE" } },
    { id:"succulent", kind:"plant", name:"Суккулент", icon:"🪴", desc:"Плотные округлые листья-подушечки", cost:50, rare:false, shape:"succulent",
      palette:{ leafFrom:"#7FB0A0", leafTo:"#3F7A66", potFrom:"#C9A277", potTo:"#A47C52", petal:"#9ED6C3", petalAlt:"#6FBFA6", center:"#EAF7F1" } },
    { id:"rare_gold_30", kind:"plant", name:"Золотая незабудка", icon:"✨", desc:"Награда за серию 30 дней подряд", cost:null, rare:true, streakThreshold:30, shape:"default",
      palette:{ leafFrom:"#B7A55A", leafTo:"#7C6B2E", potFrom:"#E7C877", potTo:"#B98F3E", petal:"#F3D98A", petalAlt:"#EBCB68", center:"#FFF7E0" } },
    { id:"rare_gold_60", kind:"plant", name:"Хрустальный папоротник", icon:"❄️", desc:"Награда за серию 60 дней подряд", cost:null, rare:true, streakThreshold:60, shape:"fern",
      palette:{ leafFrom:"#A7C7D9", leafTo:"#5E8FA6", potFrom:"#E7C877", potTo:"#B98F3E" } },
    { id:"rare_gold_100", kind:"plant", name:"Феникс-цветок", icon:"🔥", desc:"Награда за серию 100 дней подряд", cost:null, rare:true, streakThreshold:100, shape:"cactus",
      palette:{ leafFrom:"#D98A52", leafTo:"#A5522A", potFrom:"#E7C877", potTo:"#B98F3E", petal:"#F0A34F", petalAlt:"#E67A4E", center:"#FFF1D6" } },
    { id:"cat_default", kind:"cat", name:"Кот", icon:"🐱", desc:"Ваш компаньон-кот", cost:0, rare:false, shape:"cat" },
    { id:"dog_default", kind:"dog", name:"Собака", icon:"🐶", desc:"Ваш компаньон-собака", cost:0, rare:false, shape:"dog" }
  ];
  const SCENE_CATALOG = [
    { id:"windowsill", name:"Подоконник", icon:"🪟", desc:"Спокойный дневной свет — вид по умолчанию" },
    { id:"greenhouse", name:"Теплица", icon:"🌿", desc:"Мягкий зелёный свет сквозь стекло" },
    { id:"balcony", name:"Балкон на закате", icon:"🌇", desc:"Тёплые вечерние краски" }
  ];
  const ACHIEVEMENTS_CATALOG = [
    { id:"first_week", icon:"📅", title:"Первая неделя", desc:"Серия из 7 дней подряд без пропусков" },
    { id:"streak_3", icon:"🔥", title:"Разгон", desc:"Серия 3 дня подряд" },
    { id:"streak_7", icon:"🔥", title:"Неделя подряд", desc:"Серия 7 дней подряд" },
    { id:"streak_14", icon:"🔥", title:"Две недели", desc:"Серия 14 дней подряд" },
    { id:"streak_30", icon:"🏆", title:"Месяц заботы", desc:"Серия 30 дней подряд" },
    { id:"first_course", icon:"💊", title:"Курс пройден", desc:"Полностью завершён первый курс" },
    { id:"doctor_connected", icon:"🩺", title:"На связи с врачом", desc:"Подключён врач" },
    { id:"mood_diary_shared", icon:"📔", title:"Открытость", desc:"Включён показ дневника настроения врачу" },
    { id:"species_collector", icon:"🌺", title:"Коллекционер", desc:"Испробованы все виды растений в коллекции" },
    { id:"time_traveler", icon:"⏳", title:"Исследователь времени", desc:"Машина времени опробована в демо-режиме" }
  ];

  // Supportive line under the pet caption: calm, adult tone, no forced cheer
  // or guilt. Picked once per (time-of-day × health) combination so it
  // doesn't flicker on every 20s poll, and avoids repeating the same phrase
  // twice in a row within a combination.
  const SUPPORTIVE_PHRASES = {
    morning: {
      good: [
        "Утро начинается спокойно — дела идут своим чередом.",
        "Хорошее утро для того, чтобы двигаться в своём темпе.",
        "Всё по плану — самое время не торопиться.",
        "Утро тихое, и это хороший знак.",
        "День только начался, а порядок уже есть.",
        "Ровное утро — этого достаточно."
      ],
      mid: [
        "Утро как утро — не обязательно быть безупречным.",
        "Есть немного дел на сегодня, но время ещё есть.",
        "Не всё сделано, и это нормально для начала дня.",
        "Можно начать с малого — спешить некуда.",
        "Утро продолжается, дела подождут своей очереди.",
        "Небольшой пробел — не повод для тревоги."
      ],
      low: [
        "Тяжёлое утро случается — это не оценка вас как человека.",
        "Можно начать с одного маленького шага, без спешки.",
        "Не всё получается сразу, и это ожидаемо.",
        "Утро трудное — дайте себе немного времени.",
        "Один пропуск не перечёркивает всё остальное.",
        "Сегодня можно идти медленнее обычного."
      ]
    },
    day: {
      good: [
        "День идёт ровно — приятно это видеть.",
        "Хороший темп, можно продолжать так же.",
        "Дела не копятся — самое время для паузы.",
        "Середина дня спокойная, всё под контролем.",
        "Всё идёт своим чередом, без спешки.",
        "Ровный день — это тоже маленькая победа."
      ],
      mid: [
        "День в середине, кое-что ещё впереди.",
        "Есть время наверстать то, что осталось.",
        "Не всё сделано — и это обычный день.",
        "Можно вернуться к делам, когда будет удобно.",
        "Середина дня — хорошее время сверить план.",
        "Часть дел позади, часть подождёт."
      ],
      low: [
        "День выдался непростым — это тоже бывает.",
        "Не обязательно успевать всё сразу, можно постепенно.",
        "Сложный день не отменяет ваших усилий раньше.",
        "Можно сделать паузу и вернуться к делам позже.",
        "Не всё получилось — это не повод для строгости к себе.",
        "День тяжёлый, и это просто факт, а не приговор."
      ]
    },
    evening: {
      good: [
        "Вечер спокойный — день прошёл хорошо.",
        "Дела сделаны, можно отдохнуть без спешки.",
        "Ровный день подходит к концу.",
        "Хорошее завершение дня — заслуженный отдых.",
        "Всё сделано вовремя — можно выдохнуть.",
        "Вечер тихий, и это приятно."
      ],
      mid: [
        "День почти завершён, кое-что осталось на потом.",
        "Не всё успели — обычное дело к вечеру.",
        "Вечер — подходящее время подвести итог без строгости.",
        "Часть дел позади, остальное подождёт до завтра.",
        "Спокойный вечер, даже если день был неполным.",
        "Не каждый день бывает идеальным, и сегодня тоже."
      ],
      low: [
        "Тяжёлый день заканчивается — можно просто отдохнуть.",
        "Не всё получилось сегодня, и завтра будет другой день.",
        "Вечер — время остановиться, а не подводить строгие итоги.",
        "Один трудный день не определяет всё остальное.",
        "Можно лечь спать, не досчитавшись — это нормально.",
        "Сегодня было сложно, и этого достаточно, чтобы дать себе отдых."
      ]
    }
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
  let lastHealthState = null; // for the "state got better" glow, see maybeShowImprovement()
  let lastRenderedSpeciesId = null; // for the pet appear/swap animation, see renderPetScreen()

  // Plays once, on the very first paint of the pet screen (page load /
  // boot) - a gentle fade+scale-in instead of the pet just popping in.
  function playPetAppearAnimation(){
    petVisualEl.classList.remove("pet-appear");
    void petVisualEl.offsetWidth;
    petVisualEl.classList.add("pet-appear");
  }
  // Plays when the active companion species changes (Settings/Collection) -
  // fades the old picture out first, then swaps in the new content and
  // fades it in, rather than a hard cut. `applyVisuals` is whatever
  // actually swaps the shape/photo - called after the fade-out finishes.
  function playPetSwapAnimation(applyVisuals){
    petVisualEl.classList.remove("pet-appear");
    void petVisualEl.offsetWidth;
    petVisualEl.classList.add("pet-fade-out");
    setTimeout(() => {
      petVisualEl.classList.remove("pet-fade-out");
      applyVisuals();
      void petVisualEl.offsetWidth;
      petVisualEl.classList.add("pet-appear");
    }, 180);
  }

  // Durations must match the CSS (.pet-fade-out / .pet-appear above) -
  // used to time the idle "breathing" loop so it only ever engages once
  // whichever appear/swap animation is currently playing has actually
  // finished, never layered on top of it (that's the jump/jolt the spec
  // explicitly asked to avoid).
  const PET_APPEAR_MS = 450;
  const PET_SWAP_MS = 180 + 450;
  const BREATHING_STATES = ["bloom", "normal"];
  let breathingDelayTimer = null;

  // state: current health state ("bloom"/"normal"/"wilt"/"wilt-severe").
  // delayMs: 0 to apply immediately (routine re-render, nothing is
  // animating in), or the ms to wait for an in-flight appear/swap to
  // finish first. Only bloom/normal breathe - same idea as leaves holding
  // still while wilting, just expressed as a single shared class instead
  // of per-species CSS.
  function updateBreathing(state, delayMs){
    clearTimeout(breathingDelayTimer);
    const shouldBreathe = BREATHING_STATES.indexOf(state) !== -1;
    if(!shouldBreathe){
      petBreatheEl.classList.remove("breathing-active");
      return;
    }
    if(delayMs > 0){
      petBreatheEl.classList.remove("breathing-active");
      breathingDelayTimer = setTimeout(() => {
        petBreatheEl.classList.add("breathing-active");
      }, delayMs);
    }else{
      petBreatheEl.classList.add("breathing-active");
    }
  }
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
  // Render's free tier spins the server down after ~15 minutes idle; the
  // first request afterwards can take up to ~50s to come back instead of
  // failing outright. A slow-but-alive response and a genuinely broken
  // connection need different handling: the former just needs a "please
  // wait" indicator (handled by begin/endRequestTracking below), the latter
  // needs retries and, eventually, a fallback to the last data we saw.
  const CACHE_KEY = "carePatientCache_v1";
  const CACHE_META_KEY = "carePatientCacheMeta_v1";
  const PENDING_COMPLETIONS_KEY = "carePendingCompletions_v1";
  const WAKE_UP_AFTER_MS = 5000;
  const RETRY_DELAYS_MS = [3000, 6000, 10000];
  const RETRY_BUDGET_MS = 60000;

  function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

  function saveCache(patientData){
    try{
      localStorage.setItem(CACHE_KEY, JSON.stringify(patientData));
      localStorage.setItem(CACHE_META_KEY, JSON.stringify({ patientId: patientData.id, savedAt: Date.now() }));
    }catch(e){}
  }
  function loadCache(patientId){
    try{
      const meta = JSON.parse(localStorage.getItem(CACHE_META_KEY) || "null");
      if(!meta || meta.patientId !== patientId) return null;
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    }catch(e){ return null; }
  }

  function loadPendingCompletions(){
    try{ return JSON.parse(localStorage.getItem(PENDING_COMPLETIONS_KEY) || "[]"); }catch(e){ return []; }
  }
  function savePendingCompletions(list){
    try{ localStorage.setItem(PENDING_COMPLETIONS_KEY, JSON.stringify(list)); }catch(e){}
  }
  function addPendingCompletion(taskId, dateStr){
    const list = loadPendingCompletions();
    if(!list.some(p => p.taskId === taskId && p.date === dateStr)) list.push({ taskId, date: dateStr });
    savePendingCompletions(list);
  }
  function removePendingCompletion(taskId){
    savePendingCompletions(loadPendingCompletions().filter(p => p.taskId !== taskId));
  }

  const wakingBannerEl = document.getElementById("wakingBanner");
  const offlineBannerEl = document.getElementById("offlineBanner");
  const bootOverlayEl = document.getElementById("bootOverlay");
  const bootSpinnerEl = document.getElementById("bootSpinner");
  const bootTextEl = document.getElementById("bootText");
  const bootRetryBtnEl = document.getElementById("bootRetryBtn");

  let offlineMode = false;
  let inFlightCount = 0;
  let wakingTimer = null;

  function showWakingIndicator(){
    if(offlineMode) return;
    if(!data){
      bootSpinnerEl.classList.remove("hidden");
      bootTextEl.textContent = "Просыпаемся, секунду…";
      bootRetryBtnEl.classList.add("hidden");
      bootOverlayEl.classList.remove("hidden");
    }else{
      wakingBannerEl.classList.remove("hidden");
    }
  }
  function hideWakingIndicator(){
    wakingBannerEl.classList.add("hidden");
    if(!offlineMode) bootOverlayEl.classList.add("hidden");
  }
  function beginRequestTracking(){
    inFlightCount++;
    if(!wakingTimer){
      wakingTimer = setTimeout(() => {
        wakingTimer = null;
        if(inFlightCount > 0) showWakingIndicator();
      }, WAKE_UP_AFTER_MS);
    }
  }
  function endRequestTracking(){
    inFlightCount = Math.max(0, inFlightCount - 1);
    if(inFlightCount === 0){
      if(wakingTimer){ clearTimeout(wakingTimer); wakingTimer = null; }
      hideWakingIndicator();
    }
  }

  function enterOfflineMode(){
    if(offlineMode) return;
    offlineMode = true;
    bootOverlayEl.classList.add("hidden");
    wakingBannerEl.classList.add("hidden");
    offlineBannerEl.classList.remove("hidden");
  }
  let flushingPending = false;
  function exitOfflineMode(){
    if(!offlineMode) return;
    offlineMode = false;
    offlineBannerEl.classList.add("hidden");
    flushPendingCompletions();
  }

  // Retried "Done" taps recorded while offline (see markDone) - replayed
  // against the server as soon as a request succeeds again.
  async function flushPendingCompletions(){
    if(flushingPending || !data) return;
    const pending = loadPendingCompletions();
    if(pending.length === 0) return;
    flushingPending = true;
    try{
      for(const p of pending.slice()){
        try{
          await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + p.taskId + "/complete");
          removePendingCompletion(p.taskId);
        }catch(e){
          if(e.offline){ enterOfflineMode(); break; }
          removePendingCompletion(p.taskId); // server rejected it outright - nothing more to retry
        }
      }
      await refreshData();
      renderAll();
    }finally{
      flushingPending = false;
    }
  }

  async function rawFetch(method, path, body){
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

  // A cold Render instance's own proxy often answers fast with 502/503/504
  // while the container is still starting up, rather than holding the
  // connection open - so those three statuses are treated as "still waking
  // up", not as a final application error, and go through the same retry
  // path as a network-level failure. Any other HTTP status is a real
  // response from a running app (validation error, not found, etc.) and is
  // never retried.
  function isWakingUpStatus(status){
    return status === 502 || status === 503 || status === 504;
  }

  // Retries network-level failures and wake-up-flavored HTTP errors with a
  // growing delay for up to a minute before giving up. Once we know we're
  // offline, calls fail fast instead of each blocking for up to a minute; a
  // later successful call (background poll or a fresh action) is what
  // notices the connection came back.
  async function apiCall(method, path, body, callOpts){
    const allowRetry = (!callOpts || callOpts.retry !== false) && !offlineMode;
    beginRequestTracking();
    const startedAt = Date.now();
    let attempt = 0;
    try{
      while(true){
        try{
          const result = await rawFetch(method, path, body);
          exitOfflineMode();
          return result;
        }catch(e){
          const isRealAppError = e.status !== undefined && !isWakingUpStatus(e.status);
          if(isRealAppError) throw e; // never retried
          if(!allowRetry){ e.offline = true; throw e; }
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
          if(Date.now() - startedAt + delay > RETRY_BUDGET_MS){
            e.offline = true;
            throw e;
          }
          await sleep(delay);
          attempt++;
        }
      }
    }finally{
      endRequestTracking();
    }
  }

  // A connectivity failure that wasn't specifically handled by its call site
  // still shouldn't fail silently - surface it once as a calm toast instead.
  window.addEventListener("unhandledrejection", (event) => {
    if(event.reason && event.reason.offline){
      event.preventDefault();
      showToast("Нет связи с сервером — изменение не сохранено");
    }
  });

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
        saveCache(data);
        return true;
      }catch(e){
        if(e.offline){
          const cached = loadCache(existingId);
          if(cached){
            data = cached;
            enterOfflineMode();
            return true;
          }
          throw e; // no cached state to fall back to - let the caller show a real error
        }
        // stale/unknown id (e.g. server data reset) -> create a fresh patient below
      }
      data = await apiCall("POST", "/api/patients");
      setPatientId(data.id);
      saveCache(data);
      return true;
    }
    return false;
  }

  async function createNewPatient(){
    data = await apiCall("POST", "/api/patients");
    setPatientId(data.id);
    saveCache(data);
  }

  async function recoverPatientByCode(code){
    data = await apiCall("POST", "/api/patients/recover", { recoveryCode: code });
    setPatientId(data.id);
    saveCache(data);
  }

  async function refreshData(){
    try{
      data = await apiCall("GET", "/api/patients/" + data.id);
      saveCache(data);
    }catch(e){
      if(e.offline){ enterOfflineMode(); return; }
      throw e;
    }
  }

  // Used by the background poll: a single attempt, no 60s retry loop, so a
  // sleeping server doesn't pile up overlapping retries between ticks.
  async function refreshDataQuiet(){
    try{
      data = await apiCall("GET", "/api/patients/" + data.id, undefined, { retry: false });
      saveCache(data);
    }catch(e){
      if(e.offline) enterOfflineMode();
      // any other transient error - try again on the next tick, as before
    }
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

  // A 90-day course counted in days reads as one distant, boring finish line -
  // switch to weeks once a course is long enough that day-counting stops
  // being a meaningful sense of progress. Mirrors calc.courseLengthTier
  // server-side (kept in sync manually - no shared module between the two).
  function courseLengthTier(courseTotal){
    if(courseTotal <= 14) return "short";
    if(courseTotal <= 30) return "medium";
    return "long";
  }
  function courseProgressText(task){
    const progress = courseProgress(task);
    if(courseLengthTier(task.courseTotal) === "long"){
      const totalWeeks = Math.ceil(task.courseTotal / 7);
      const currentWeek = Math.min(Math.ceil(progress / 7) || 1, totalWeeks);
      const pct = Math.round(progress / task.courseTotal * 100);
      return "Неделя " + currentWeek + " из " + totalWeeks + " (" + pct + "%)";
    }
    return "Курс: " + progress + " из " + task.courseTotal + " дней";
  }
  // Tick marks on the progress bar at 25/50/75% - only medium-length courses
  // (15-30 days) get them; short courses finish before a mid-course mark
  // would mean anything, long ones already have the weekly text instead.
  function courseProgressMarkers(task){
    if(courseLengthTier(task.courseTotal) !== "medium") return [];
    return [25, 50, 75];
  }

  // ---------- native reminders (Capacitor LocalNotifications - no-op outside the app) ----------
  // window.Capacitor.Plugins is injected by the native Android WebView at
  // runtime; it doesn't exist when this same file is opened in a plain
  // browser tab, so every call below is guarded and silently does nothing there.
  const LocalNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  const notificationsAvailable = !!LocalNotifications;
  let notificationPermissionGranted = false;

  // Resolved at the end of finishBoot(), once `data` (the patient's full
  // state) is loaded. A notification action can fire before that - e.g. the
  // OS cold-starts the app just to deliver the tap - so the "done" handler
  // awaits this before touching `data`.
  let resolveAppReady;
  const appReadyPromise = new Promise((res) => { resolveAppReady = res; });

  // Deterministic 32-bit-safe id derived from the task's string id, so the
  // same task always maps to the same notification id(s) without needing a
  // separate counter to persist. Slot 0-6 = a specific weekday (WEEKDAY_KEYS
  // index), slot 8 = a one-off snooze reminder, slot 9 = the single/daily
  // notification for non-weekday tasks.
  function notifBaseId(taskId){
    let h = 5381;
    for(let i = 0; i < taskId.length; i++){
      h = ((h * 33) ^ taskId.charCodeAt(i)) >>> 0;
    }
    return (h % 90000000) + 1000000; // 7-8 digit positive int
  }
  function notifSlotId(taskId, slot){
    return notifBaseId(taskId) * 10 + slot;
  }
  // Slot 7 = the "still not done" late reminder, one per task (today's
  // occurrence only - see ensureLateReminder below).
  const ALL_NOTIF_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const TASK_REMINDER_ACTION_TYPE = "TASK_REMINDER";

  // Two Android notification channels, sound-on vs sound-off, so the
  // existing "Звук" setting can actually mute reminders - Android only
  // lets an app pick a channel's sound at channel *creation* time, not per
  // notification or after the fact, so "toggle sound" has to mean "route
  // through the other channel" rather than a per-notification flag.
  // LOW importance is the one Android importance level guaranteed silent;
  // HIGH gives the sound-on channel a heads-up popup too, which suits a
  // medication reminder with actionable Done/Snooze buttons.
  const NOTIF_CHANNEL_SOUND = "reminders";
  const NOTIF_CHANNEL_SILENT = "reminders_silent";
  let notificationChannelsReady = false;

  async function ensureNotificationChannels(){
    if(!notificationsAvailable || notificationChannelsReady) return;
    try{
      await LocalNotifications.createChannel({
        id: NOTIF_CHANNEL_SOUND,
        name: "Напоминания (со звуком)",
        description: "Напоминания о задачах и повторные напоминания при задержке",
        importance: 4,
        visibility: 1,
        vibration: true
      });
      await LocalNotifications.createChannel({
        id: NOTIF_CHANNEL_SILENT,
        name: "Напоминания (без звука)",
        description: "То же самое, но без звука - для тех, кто выключил звук в настройках",
        importance: 2,
        visibility: 1,
        vibration: false
      });
      notificationChannelsReady = true;
    }catch(e){}
  }

  function currentNotificationChannelId(){
    return getData().soundEnabled === false ? NOTIF_CHANNEL_SILENT : NOTIF_CHANNEL_SOUND;
  }

  // How long after a timed task's due time to send a second, separate
  // reminder if it's still not marked done.
  const LATE_REMINDER_DELAY_MS = 10 * 60 * 1000;
  // Never signed as a personal note from the real doctor - the notification
  // title uses the companion's own name ("<имя> напоминает"), not the
  // doctor's, specifically so it can't be mistaken for one.
  const LATE_REMINDER_MESSAGES = [
    "Эй, дружище, не забудь про свою таблетку — самое время.",
    "Твой компаньон немного заскучал без внимания. Не забыл про приём?",
    "Небольшое напоминание — время для твоей дозы уже подошло.",
    "Похоже, ты немного задержался. Всё в порядке? Не забудь про лекарство.",
    "Пара минут — и всё будет по расписанию. Пора принять лекарство.",
    "Твой организм скажет спасибо, если не откладывать это надолго.",
    "Просто напоминаем — время приёма уже наступило.",
    "Небольшая заминка? Ничего страшного, просто не забудь сейчас.",
    "Твой компаньон подождёт, но лучше не затягивать с приёмом.",
    "Самое время позаботиться о себе — пора принять лекарство.",
    "Пропустить легко забыть, поэтому мы здесь, чтобы напомнить.",
    "Пора вернуться к расписанию — твой приём ждёт.",
    "Пять минут на себя — и дело сделано. Не забудь про лекарство.",
    "Пусть это будет маленькой, но важной привычкой сегодня.",
    "Пора — твой компаньон будет рад, что ты не забыл."
  ];

  // What should currently be scheduled for this task, if anything. Paused and
  // already-finished courses don't get reminders - there's nothing useful to
  // remind about, and it would just train the patient to ignore the app.
  function taskNotificationPlan(task){
    if(!task.time) return [];
    if(isTaskCurrentlyPaused(getData(), task)) return [];
    if(task.type === "course" && isCourseFinished(task)) return [];
    const [hh, mm] = task.time.split(":").map(Number);
    if(task.type === "weekday"){
      return (task.weekdays || []).map(key => {
        const idx = WEEKDAY_KEYS.indexOf(key);
        if(idx === -1) return null;
        return { slot: idx, weekday: idx + 1, hour: hh, minute: mm };
      }).filter(Boolean);
    }
    if(task.type === "once"){
      const [y, m, d] = task.createdDate.split("-").map(Number);
      return [{ slot: 9, at: new Date(y, m - 1, d, hh, mm, 0) }];
    }
    // ongoing, or a course that isn't finished yet - remind daily
    return [{ slot: 9, hour: hh, minute: mm }];
  }

  async function checkAndRequestNotificationPermission(){
    if(!notificationsAvailable) return false;
    try{
      let status = await LocalNotifications.checkPermissions();
      if(status.display === "prompt" || status.display === "prompt-with-rationale"){
        status = await LocalNotifications.requestPermissions();
      }
      notificationPermissionGranted = status.display === "granted";
    }catch(e){
      notificationPermissionGranted = false;
    }
    if(notificationPermissionGranted) await ensureNotificationChannels();
    return notificationPermissionGranted;
  }

  async function cancelTaskNotifications(taskId){
    if(!notificationsAvailable) return;
    try{
      await LocalNotifications.cancel({ notifications: ALL_NOTIF_SLOTS.map(slot => ({ id: notifSlotId(taskId, slot) })) });
    }catch(e){}
  }

  async function scheduleTaskNotifications(task){
    if(!notificationsAvailable || !notificationPermissionGranted) return;
    await cancelTaskNotifications(task.id);
    const plan = taskNotificationPlan(task);
    if(plan.length > 0){
      const companionName = getData().companionName || "Незабудка";
      const body = companionName + " напоминает: " + task.name;
      const channelId = currentNotificationChannelId();
      const notifications = plan.map(p => {
        const base = {
          id: notifSlotId(task.id, p.slot),
          title: companionName,
          body,
          actionTypeId: TASK_REMINDER_ACTION_TYPE,
          channelId,
          extra: { taskId: task.id }
        };
        if(p.at) return { ...base, schedule: { at: p.at, allowWhileIdle: true } };
        if(p.weekday) return { ...base, schedule: { on: { weekday: p.weekday, hour: p.hour, minute: p.minute }, allowWhileIdle: true } };
        return { ...base, schedule: { on: { hour: p.hour, minute: p.minute }, allowWhileIdle: true } };
      });
      try{
        await LocalNotifications.schedule({ notifications });
      }catch(e){}
    }
    // cancelTaskNotifications above also wiped slot 7 (late reminder) -
    // recompute whether today's occurrence still needs one.
    await ensureLateReminder(task);
  }

  // A second, separate reminder if a timed task is still not done
  // LATE_REMINDER_DELAY_MS after its scheduled time - deliberately not
  // signed as a personal message from the real doctor (title is the
  // companion's own name, never assignedByDoctorName), so it can't be
  // mistaken for the doctor writing in personally. One slot per task,
  // always for *today's* occurrence - recomputed (not persisted) from
  // isDueOn/isDoneOn every time this runs, so call sites just need to call
  // it again whenever due/done state might have changed (markDone, the
  // poll loop, task create/edit/resume). Capacitor has no background
  // scheduling API of its own, so this only stays accurate for days the
  // app has actually been opened - same limitation reconcileAllNotifications
  // documents for the main reminders.
  async function ensureLateReminder(task){
    if(!notificationsAvailable || !notificationPermissionGranted) return;
    const lateId = notifSlotId(task.id, 7);
    const currentData = getData();
    if(!task.time || isTaskCurrentlyPaused(currentData, task)){
      try{ await LocalNotifications.cancel({ notifications: [{ id: lateId }] }); }catch(e){}
      return;
    }
    const today = currentDateStr(currentData);
    if(!isDueOn(task, today) || isDoneOn(task, today)){
      try{ await LocalNotifications.cancel({ notifications: [{ id: lateId }] }); }catch(e){}
      return;
    }
    const [hh, mm] = task.time.split(":").map(Number);
    const now = new Date();
    const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    const lateAt = new Date(dueAt.getTime() + LATE_REMINDER_DELAY_MS);
    if(lateAt.getTime() <= now.getTime()){
      try{ await LocalNotifications.cancel({ notifications: [{ id: lateId }] }); }catch(e){}
      return;
    }
    const message = LATE_REMINDER_MESSAGES[Math.floor(Math.random() * LATE_REMINDER_MESSAGES.length)];
    try{
      await LocalNotifications.schedule({ notifications: [{
        id: lateId,
        title: (currentData.companionName || "Незабудка") + " напоминает",
        body: message,
        actionTypeId: TASK_REMINDER_ACTION_TYPE,
        channelId: currentNotificationChannelId(),
        extra: { taskId: task.id, late: true },
        schedule: { at: lateAt, allowWhileIdle: true }
      }] });
    }catch(e){}
  }

  async function ensureAllLateReminders(){
    if(!notificationsAvailable || !notificationPermissionGranted) return;
    for(const task of getData().tasks){
      await ensureLateReminder(task);
    }
  }

  // Unconditional reschedule of every task's notifications - unlike
  // reconcileAllNotifications, which only re-schedules when the set of
  // pending ids has actually diverged. Toggling the sound setting doesn't
  // change which ids are scheduled, only which channel they should be on,
  // so that shortcut would otherwise skip moving already-pending
  // notifications to the new channel.
  async function rescheduleAllNotificationsForChannelChange(){
    if(!notificationsAvailable || !notificationPermissionGranted) return;
    for(const task of getData().tasks){
      await scheduleTaskNotifications(task);
    }
  }

  // Registers the "Done" / "Snooze 10 min" notification buttons and the
  // listener that handles taps on them.
  //
  // Reliability choice: both actions need the app's own JS to run in order
  // to do anything (mark a task done against the server, or reschedule a
  // reminder). Capacitor's LocalNotifications only delivers action taps to
  // that JS by bringing the app's WebView up - there's no supported way on
  // Android to run this fully in the background without writing a native
  // BroadcastReceiver + WorkManager pair outside Capacitor, which is out of
  // scope here. So rather than pretend this is silent, both actions openly
  // (briefly) bring the app forward and finish the job there - "Done"
  // completes the task and lands on the pet screen with a confirmation
  // toast, "Snooze" reschedules the reminder - instead of failing silently.
  async function registerNotificationHandlers(){
    if(!notificationsAvailable) return;
    try{
      await LocalNotifications.registerActionTypes({
        types: [{
          id: TASK_REMINDER_ACTION_TYPE,
          actions: [
            { id: "done", title: "Сделано" },
            { id: "snooze", title: "Отложить на 10 минут" }
          ]
        }]
      });
    }catch(e){}
    LocalNotifications.addListener("localNotificationActionPerformed", handleNotificationAction);
  }

  async function snoozeTaskNotification(taskId, title, body){
    if(!notificationsAvailable) return;
    const snoozeId = notifSlotId(taskId, 8);
    try{
      await LocalNotifications.cancel({ notifications: [{ id: snoozeId }] });
      await LocalNotifications.schedule({
        notifications: [{
          id: snoozeId,
          title: title || "Незабудка",
          body: body || "Напоминание",
          actionTypeId: TASK_REMINDER_ACTION_TYPE,
          channelId: currentNotificationChannelId(),
          extra: { taskId },
          schedule: { at: new Date(Date.now() + 10 * 60 * 1000), allowWhileIdle: true }
        }]
      });
    }catch(e){}
  }

  async function handleNotificationAction(event){
    const actionId = event && event.actionId;
    const notification = (event && event.notification) || {};
    const taskId = (notification.extra || {}).taskId;
    if(!taskId) return;

    if(actionId === "snooze"){
      await snoozeTaskNotification(taskId, notification.title, notification.body);
      showToast("Напомним через 10 минут");
      return;
    }
    if(actionId === "done"){
      await appReadyPromise;
      await markDone(taskId);
      activateTab("pet");
      showToast("Отмечено по уведомлению");
    }
  }

  // Runs once per app start: compares what's actually scheduled on the device
  // against what the current task list expects. A mismatch (reinstalled app,
  // OS killed the alarm store, etc.) triggers a full cancel-then-reschedule
  // from scratch rather than trying to patch the difference.
  async function reconcileAllNotifications(){
    if(!notificationsAvailable || !notificationPermissionGranted) return;
    const currentData = getData();
    const expected = new Set();
    currentData.tasks.forEach(task => {
      taskNotificationPlan(task).forEach(p => expected.add(notifSlotId(task.id, p.slot)));
    });
    let pending = [];
    try{
      const res = await LocalNotifications.getPending();
      pending = (res && res.notifications) || [];
    }catch(e){ pending = []; }
    const pendingIds = new Set(pending.map(n => n.id));
    let diverged = pendingIds.size !== expected.size;
    if(!diverged){
      for(const id of expected){
        if(!pendingIds.has(id)){ diverged = true; break; }
      }
    }
    if(!diverged) return;
    try{
      if(pending.length) await LocalNotifications.cancel({ notifications: pending.map(n => ({ id: n.id })) });
    }catch(e){}
    for(const task of currentData.tasks){
      await scheduleTaskNotifications(task);
    }
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

  // ---------- monthly summary (shown once per real calendar month) ----------
  const MONTH_SUMMARY_KEY = "careMonthSummaryShown_v1";
  const MONTH_SUMMARY_THRESHOLD_PCT = 70;

  // Tied to the real calendar month, not the in-app time machine - jumping
  // the demo date around shouldn't trigger or skip this.
  function currentRealYearMonth(){
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
  }

  function computeMonthlySummary(data){
    const ym = currentRealYearMonth();
    const today = realTodayStr();
    const firstOfMonth = ym + "-01";
    let due = 0, done = 0;
    for(let d = firstOfMonth; d <= today; d = addDays(d, 1)){
      const s = dayStats(data, d);
      due += s.due; done += s.done;
    }
    const pct = due === 0 ? 0 : Math.round(done/due*100);
    const finishedCourses = data.tasks.filter(t => t.type === "course" && isCourseFinished(t)).length;
    return { pct, due, streak: computeStreak(data), finishedCourses };
  }

  function maybeShowMonthlySummary(){
    const ym = currentRealYearMonth();
    let lastShown = null;
    try{ lastShown = localStorage.getItem(MONTH_SUMMARY_KEY); }catch(e){}
    if(lastShown === ym) return;
    const summary = computeMonthlySummary(getData());
    if(summary.due === 0 || summary.pct < MONTH_SUMMARY_THRESHOLD_PCT) return;
    document.getElementById("monthSummaryStreak").textContent = String(summary.streak);
    document.getElementById("monthSummaryPct").textContent = summary.pct + "%";
    document.getElementById("monthSummaryCourses").textContent = String(summary.finishedCourses);
    document.getElementById("monthSummaryOverlay").classList.remove("hidden");
    try{ localStorage.setItem(MONTH_SUMMARY_KEY, ym); }catch(e){}
  }

  document.getElementById("monthSummaryClose").addEventListener("click", () => {
    document.getElementById("monthSummaryOverlay").classList.add("hidden");
  });

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
  const petStageImg = document.getElementById("petStageImg");
  const petVisualEl = document.getElementById("petVisual");
  const petBreatheEl = document.getElementById("petBreathe");
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
  const petPhraseEl = document.getElementById("petPhrase");
  const stageWrapEl = document.getElementById("stageWrap");

  function speciesInfo(id){
    return SPECIES_CATALOG.find(s => s.id === id) || SPECIES_CATALOG[0];
  }

  const COMPANION_SHAPES = ["default","succulent","fern","cactus","ivy","cat","dog"];

  function applySpeciesTheme(speciesId){
    const info = speciesInfo(speciesId);
    const shape = info.shape || "default";

    plantStage.classList.remove(...COMPANION_SHAPES.map(s => "shape-" + s));
    plantStage.classList.add("shape-" + shape);
    plantStage.classList.toggle("rare-active", !!info.rare);
    plantStage.classList.toggle("photo-active", !!PHOTO_STATE_FILES[speciesId]);

    // Cat/dog carry their own fixed fur colors baked into the markup (there's
    // only one species per kind so far, nothing to recolor) instead of the
    // leaf/pot gradient + flower recolor system below, which is plant-only.
    if(info.kind && info.kind !== "plant") return;

    const p = info.palette;
    const leafStops = document.querySelectorAll("#leafGrad stop");
    if(leafStops[0]) leafStops[0].setAttribute("stop-color", p.leafFrom);
    if(leafStops[1]) leafStops[1].setAttribute("stop-color", p.leafTo);
    const potStops = document.querySelectorAll("#potGrad stop");
    if(potStops[0]) potStops[0].setAttribute("stop-color", p.potFrom);
    if(potStops[1]) potStops[1].setAttribute("stop-color", p.potTo);

    // Only the active shape's own flowers exist to recolor - fern/ivy carry
    // none at all (that's the point: some species just never flower).
    const activeShapeEl = document.querySelector("#plantStage .shape-" + shape);
    if(activeShapeEl && p.petal){
      activeShapeEl.querySelectorAll("g.flower").forEach((g, i) => {
        const color = (i % 2 === 0) ? p.petal : p.petalAlt;
        g.querySelectorAll("ellipse").forEach(el => el.setAttribute("fill", color));
        const circle = g.querySelector("circle");
        if(circle) circle.setAttribute("fill", p.center);
      });
    }
  }

  function applyScene(sceneId){
    stageWrapEl.classList.remove("scene-greenhouse","scene-balcony","scene-windowsill");
    stageWrapEl.classList.add("scene-" + (sceneId === "greenhouse" || sceneId === "balcony" ? sceneId : "windowsill"));
  }

  function timeOfDayBucket(){
    const h = new Date().getHours();
    if(h >= 6 && h < 12) return "morning";
    if(h >= 12 && h < 18) return "day";
    return "evening";
  }
  function moodBucketFromPct(pct){
    if(pct >= 70) return "good";
    if(pct >= 40) return "mid";
    return "low";
  }
  let lastPhraseKey = null;
  let lastPhraseText = "";
  function supportivePhrase(pct){
    const tod = timeOfDayBucket();
    const mood = moodBucketFromPct(pct);
    const key = tod + "|" + mood;
    if(key === lastPhraseKey) return lastPhraseText;
    const pool = SUPPORTIVE_PHRASES[tod][mood];
    const storageKey = "carePhraseLast_" + key;
    let lastIdx = Number(localStorage.getItem(storageKey));
    let idx;
    do{ idx = Math.floor(Math.random() * pool.length); }while(pool.length > 1 && idx === lastIdx);
    localStorage.setItem(storageKey, String(idx));
    lastPhraseKey = key;
    lastPhraseText = pool[idx];
    return lastPhraseText;
  }

  // ---------- achievements: unobtrusive unlock toast ----------
  const ACHV_SEEN_KEY = "careSeenAchievements_v1";
  function getSeenAchievementIds(){
    try{ return JSON.parse(localStorage.getItem(ACHV_SEEN_KEY) || "[]"); }catch(e){ return []; }
  }
  function checkNewAchievements(data){
    const unlockedIds = (data.achievements || []).map(a => a.id);
    const seen = getSeenAchievementIds();
    const newOnes = unlockedIds.filter(id => seen.indexOf(id) === -1);
    if(newOnes.length){
      const info = ACHIEVEMENTS_CATALOG.find(a => a.id === newOnes[0]);
      if(info) showToast("🏆 Новое достижение: " + info.title, 3200);
    }
    localStorage.setItem(ACHV_SEEN_KEY, JSON.stringify(unlockedIds));
  }

  function renderPetScreen(){
    const data = getData();
    const pct = computeHealthPercent(data);
    const state = healthState(pct);
    const info = stateInfoFor(state, speciesInfo(data.activeSpeciesId).kind);

    // First-ever paint gets a plain fade+scale in; switching companion
    // species gets a fade-out-then-in crossfade (see playPetSwapAnimation).
    // A state change within the same species (e.g. wilt -> bloom) does
    // neither - that's maybeShowImprovement's glow, left alone below.
    const isFirstRender = lastRenderedSpeciesId === null;
    const speciesChanged = !isFirstRender && lastRenderedSpeciesId !== data.activeSpeciesId;
    lastRenderedSpeciesId = data.activeSpeciesId;

    petNameDisplayEl.textContent = data.companionName || "Незабудка";
    petStatus.textContent = info.label;
    petCaption.textContent = info.caption;
    petPhraseEl.textContent = supportivePhrase(pct);
    moodIcon.textContent = info.icon;
    moodLabel.textContent = info.label;

    applyScene(data.activeSceneId);
    checkNewAchievements(data);

    function applyPetVisuals(){
      plantStage.classList.remove("state-bloom","state-normal","state-wilt","state-wilt-severe");
      plantStage.classList.add("state-"+state);
      maybeShowImprovement(state);

      applySpeciesTheme(data.activeSpeciesId);

      const photoStates = PHOTO_STATE_FILES[data.activeSpeciesId];
      if(photoStates){
        petStageImg.src = photoStates[state];
        petStageImg.alt = info.label;
      }
    }

    if(speciesChanged){
      playPetSwapAnimation(applyPetVisuals);
      updateBreathing(state, PET_SWAP_MS);
    }else{
      applyPetVisuals();
      if(isFirstRender){
        playPetAppearAnimation();
        updateBreathing(state, PET_APPEAR_MS);
      }else{
        updateBreathing(state, 0);
      }
    }

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

  // A brief, calm glow + a few rising sparks the moment the plant's health
  // state improves (e.g. right after marking today's tasks done pushes it
  // from "wilt" to "normal"). Never fires on the very first render of a
  // session (lastHealthState is null then) or when the state stays the same
  // or gets worse.
  const HEALTH_STATE_ORDER = ["wilt-severe","wilt","normal","bloom"];
  function maybeShowImprovement(newState){
    const prev = lastHealthState;
    lastHealthState = newState;
    if(prev === null || prev === newState) return;
    if(HEALTH_STATE_ORDER.indexOf(newState) <= HEALTH_STATE_ORDER.indexOf(prev)) return;

    plantStage.classList.remove("improve-glow");
    void plantStage.offsetWidth;
    plantStage.classList.add("improve-glow");
    setTimeout(() => plantStage.classList.remove("improve-glow"), 1700);

    [-18, 0, 20].forEach((dx, i) => {
      setTimeout(() => spawnFloatText(plantStage, "✨", "float-spark", dx), i * 160);
    });
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
    else if(task.type === "course") parts.push(courseProgressText(task));
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
          courseProgressMarkers(task).forEach(pct => {
            const marker = document.createElement("div");
            marker.className = "task-progress-marker";
            marker.style.left = pct + "%";
            track.appendChild(marker);
          });
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
    await cancelTaskNotifications(taskId);
    renderAll();
  }

  async function resumeTask(taskId){
    await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + taskId + "/resume");
    await refreshData();
    const resumed = data.tasks.find(t => t.id === taskId);
    if(resumed) await scheduleTaskNotifications(resumed);
    renderAll();
  }

  async function deleteTask(taskId){
    const task = data.tasks.find(t => t.id === taskId);
    if(!task) return;
    if(!confirm("Удалить «" + task.name + "»?")) return;
    await apiCall("DELETE", "/api/patients/" + data.id + "/obligations/" + taskId);
    await cancelTaskNotifications(taskId);
    await refreshData();
    renderAll();
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  let toastTimer = null;
  function showToast(text, duration){
    const toast = document.getElementById("toast");
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration || 1800);
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
    const today = currentDateStr(data);
    const task = data.tasks.find(t => t.id === taskId);
    const wasAlreadyDone = task ? isDoneOn(task, today) : false;
    if(task && !wasAlreadyDone){
      // Reflect the tap immediately regardless of connectivity - reconciled
      // against the server's real response below, or queued for retry if
      // we turn out to be offline, so a slow/dead connection never makes
      // "Done" look like it did nothing.
      task.completions.push(today);
      data.points = (data.points || 0) + POINTS_PER_COMPLETION;
      lastCompletedId = taskId;
      renderAll();
      await ensureLateReminder(task);
    }

    let result;
    try{
      result = await apiCall("POST", "/api/patients/" + data.id + "/obligations/" + taskId + "/complete");
    }catch(e){
      if(e.offline){
        if(task && !wasAlreadyDone){
          addPendingCompletion(taskId, today);
          saveCache(data);
          enterOfflineMode();
        }
        return;
      }
      if(task && !wasAlreadyDone){
        task.completions = task.completions.filter(d => d !== today);
        data.points = Math.max(0, (data.points || 0) - POINTS_PER_COMPLETION);
        renderAll();
        await ensureLateReminder(task);
      }
      return;
    }
    if(result.alreadyDone){
      await refreshData();
      renderAll();
      return;
    }
    lastCompletedId = taskId;
    const justFinished = result.justFinished;
    const courseMilestone = result.courseMilestone;
    await refreshData();
    renderAll();
    const doneTask = data.tasks.find(t => t.id === taskId);
    if(doneTask){
      // "once" tasks are done for good once marked - stop reminding about them.
      // A course that just finished is the same story; anything still ongoing
      // (daily / weekday) keeps its reminder for the next occurrence.
      if(doneTask.type === "once" || justFinished) await cancelTaskNotifications(taskId);
      else await ensureLateReminder(doneTask);
    }
    if(justFinished){
      if(doneTask) showCourseCompleteModal(doneTask);
    }else if(courseMilestone){
      if(doneTask) showCourseMilestoneReaction(doneTask, courseMilestone);
    }
  }

  // A smaller beat than the full course-finished celebration - a mid-course
  // "still going" reaction so a 15-90 day course doesn't feel like one
  // distant finish line. See calc.courseMilestoneForProgress (server) for
  // when this fires: 25/50/75% marks for 15-30 day courses, once a week for
  // longer ones.
  function showCourseMilestoneReaction(task, milestone){
    [-16, 8].forEach((dx, i) => {
      setTimeout(() => spawnFloatText(plantStage, "⭐", "float-spark", dx), i * 150);
    });
    const label = milestone.type === "week"
      ? "Неделя " + milestone.week + " курса «" + task.name + "» позади"
      : milestone.value + "% курса «" + task.name + "» позади";
    showToast("⭐ " + label, 2600);
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
    journal: document.getElementById("screen-journal"),
    collection: document.getElementById("screen-collection"),
    achievements: document.getElementById("screen-achievements")
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
  document.querySelectorAll("#templateChips .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      taskNameInput.value = btn.dataset.name;
      taskNameInput.focus();
    });
  });
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

    let savedTask;
    if(editingTaskId){
      savedTask = await apiCall("PATCH", "/api/patients/" + data.id + "/obligations/" + editingTaskId, payload);
    }else{
      savedTask = await apiCall("POST", "/api/patients/" + data.id + "/obligations", payload);
    }

    await refreshData();
    const freshTask = data.tasks.find(t => t.id === savedTask.id);
    if(freshTask) await scheduleTaskNotifications(freshTask);
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
  const notificationsDisabledHintEl = document.getElementById("notificationsDisabledHint");

  function applyTheme(theme){
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }

  async function openSettings(){
    const data = getData();
    companionNameInput.value = data.companionName || "Незабудка";
    themeToggle.checked = data.theme === "dark";
    soundToggle.checked = data.soundEnabled !== false;
    if(notificationsAvailable){
      // Re-check on every open: the user may have flipped the OS-level
      // permission since the app started, without us getting a callback for it.
      try{
        const status = await LocalNotifications.checkPermissions();
        const wasGranted = notificationPermissionGranted;
        notificationPermissionGranted = status.display === "granted";
        if(notificationPermissionGranted && !wasGranted){
          await ensureNotificationChannels();
          reconcileAllNotifications();
        }
      }catch(e){}
      notificationsDisabledHintEl.classList.toggle("hidden", notificationPermissionGranted);
    }else{
      notificationsDisabledHintEl.classList.add("hidden");
    }
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
    // Move already-scheduled reminders onto the matching sound/silent
    // channel right away, instead of waiting for the next natural
    // reschedule (task edit, markDone, the poll loop).
    await rescheduleAllNotificationsForChannelChange();
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
  const companionTypeButtons = Array.from(document.querySelectorAll("#companionTypeGrid .companion-type-card"));
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
    flushPendingCompletions();
    maybeShowMonthlySummary();
    if(notificationsAvailable){
      await checkAndRequestNotificationPermission();
      await reconcileAllNotifications();
      await ensureAllLateReminders();
    }
    resolveAppReady();
  }

  companionTypeButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      companionTypeButtons.forEach((b) => { b.disabled = true; });
      try{
        await createNewPatient();
        const kind = btn.dataset.companionType;
        if(kind !== "plant"){
          data = await apiCall("POST", "/api/patients/" + data.id + "/collection/species/" + kind + "_default/select");
          saveCache(data);
        }
        hideWelcomeOverlay();
        await finishBoot();
      }catch(e){
        companionTypeButtons.forEach((b) => { b.disabled = false; });
        alert("Не удалось создать нового пациента. Убедитесь, что сервер запущен.");
      }
    });
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
      await refreshDataQuiet();
      renderAll();
      // Keeps today's late reminders (see ensureLateReminder) accurate while
      // the app is open - due time passing, a task getting marked done from
      // another device, midnight rolling over to a new "today".
      await ensureAllLateReminders();
    }, POLL_INTERVAL_MS);
  }

  // ---------- rendering: collection (species + scenes) ----------
  const collectionSpeciesGridEl = document.getElementById("collectionSpeciesGrid");
  const collectionSceneGridEl = document.getElementById("collectionSceneGrid");

  async function buySpecies(speciesId){
    try{
      data = await apiCall("POST", "/api/patients/" + data.id + "/collection/species/" + speciesId + "/buy");
      renderAll();
    }catch(e){
      showToast(e.body && e.body.error === "not_enough_points" ? "Не хватает баллов" : "Не удалось купить");
    }
  }
  async function selectSpecies(speciesId){
    data = await apiCall("POST", "/api/patients/" + data.id + "/collection/species/" + speciesId + "/select");
    renderAll();
  }
  async function selectScene(sceneId){
    data = await apiCall("POST", "/api/patients/" + data.id + "/collection/scene/" + sceneId + "/select");
    renderAll();
  }

  function renderCollectionScreen(){
    const data = getData();
    const owned = data.ownedSpeciesIds || ["default"];

    collectionSpeciesGridEl.innerHTML = "";
    SPECIES_CATALOG.forEach(sp => {
      const isOwned = owned.indexOf(sp.id) !== -1;
      const isActive = data.activeSpeciesId === sp.id;

      const tile = document.createElement("div");
      tile.className = "species-tile" + (sp.rare ? " rare" : "") + (isOwned ? "" : " locked") + (isActive ? " active" : "");

      const iconEl = document.createElement("span");
      iconEl.className = "species-icon";
      iconEl.textContent = sp.icon;
      tile.appendChild(iconEl);

      const nameEl = document.createElement("div");
      nameEl.className = "species-name";
      nameEl.textContent = sp.name;
      tile.appendChild(nameEl);

      const metaEl = document.createElement("div");
      metaEl.className = "species-meta";
      metaEl.textContent = sp.rare
        ? (isOwned ? "Получено за серию " + sp.streakThreshold + " дней" : "Награда за серию " + sp.streakThreshold + " дней подряд")
        : (isOwned ? sp.desc : sp.cost + " баллов");
      tile.appendChild(metaEl);

      if(isActive){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Выбрано";
        btn.disabled = true;
        tile.appendChild(btn);
      }else if(isOwned){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Выбрать";
        btn.addEventListener("click", () => selectSpecies(sp.id));
        tile.appendChild(btn);
      }else if(!sp.rare){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Купить";
        btn.disabled = data.points < sp.cost;
        btn.addEventListener("click", () => buySpecies(sp.id));
        tile.appendChild(btn);
      }
      collectionSpeciesGridEl.appendChild(tile);
    });

    collectionSceneGridEl.innerHTML = "";
    SCENE_CATALOG.forEach(sc => {
      const isActive = (data.activeSceneId || "windowsill") === sc.id;
      const tile = document.createElement("div");
      tile.className = "scene-tile" + (isActive ? " active" : "");

      const iconEl = document.createElement("span");
      iconEl.className = "scene-icon";
      iconEl.textContent = sc.icon;
      tile.appendChild(iconEl);

      const nameEl = document.createElement("div");
      nameEl.className = "scene-name";
      nameEl.textContent = sc.name;
      tile.appendChild(nameEl);

      const descEl = document.createElement("div");
      descEl.className = "scene-desc";
      descEl.textContent = sc.desc;
      tile.appendChild(descEl);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = isActive ? "Выбрано" : "Выбрать";
      btn.disabled = isActive;
      btn.addEventListener("click", () => selectScene(sc.id));
      tile.appendChild(btn);

      collectionSceneGridEl.appendChild(tile);
    });
  }

  // ---------- rendering: achievements ----------
  const achievementsGridEl = document.getElementById("achievementsGrid");
  function renderAchievementsScreen(){
    const data = getData();
    const unlockedIds = (data.achievements || []).map(a => a.id);
    achievementsGridEl.innerHTML = "";
    ACHIEVEMENTS_CATALOG.forEach(a => {
      const unlocked = unlockedIds.indexOf(a.id) !== -1;
      const tile = document.createElement("div");
      tile.className = "achv-tile" + (unlocked ? " unlocked" : " locked");

      const iconEl = document.createElement("span");
      iconEl.className = "achv-icon";
      iconEl.textContent = a.icon;
      tile.appendChild(iconEl);

      const titleEl = document.createElement("div");
      titleEl.className = "achv-title";
      titleEl.textContent = a.title;
      tile.appendChild(titleEl);

      const descEl = document.createElement("div");
      descEl.className = "achv-desc";
      descEl.textContent = a.desc;
      tile.appendChild(descEl);

      achievementsGridEl.appendChild(tile);
    });
  }

  // ---------- init ----------
  function renderAll(){
    renderPetScreen();
    renderTasksScreen();
    renderTimeMachine();
    renderRewardsScreen();
    renderJournalScreen();
    renderCollectionScreen();
    renderAchievementsScreen();
    renderHeaderBadges();
    renderBanner();
  }

  function showBootError(){
    bootSpinnerEl.classList.add("hidden");
    bootTextEl.textContent = "Не удалось подключиться к серверу. Проверьте соединение с интернетом и попробуйте ещё раз.";
    bootRetryBtnEl.classList.remove("hidden");
    bootOverlayEl.classList.remove("hidden");
  }

  // Runs the connect-or-restore-patient sequence; re-run from the boot
  // screen's retry button if it fails with no cached data to fall back on.
  async function boot(){
    let hasPatient;
    try{
      hasPatient = await ensurePatient();
    }catch(e){
      showBootError();
      return;
    }
    bootOverlayEl.classList.add("hidden");
    if(!hasPatient){
      showWelcomeOverlay();
      return;
    }
    await finishBoot();
  }

  bootRetryBtnEl.addEventListener("click", () => {
    bootRetryBtnEl.disabled = true;
    boot().finally(() => { bootRetryBtnEl.disabled = false; });
  });

  (async function init(){
    await registerNotificationHandlers();
    await boot();
  })();
})();
