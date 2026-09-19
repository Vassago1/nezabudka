"use strict";

// Shared date / due / streak logic, mirrored from the original client-only app
// so patient sync payloads and doctor summaries agree on the same rules.

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
function realTodayStr() {
  return formatDate(new Date());
}
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return formatDate(dt);
}
function dowKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAY_KEYS[new Date(y, m - 1, d).getDay()];
}

function isPausedOn(obligation, dateStr) {
  const ranges = obligation.pausedRanges || [];
  return ranges.some((r) => dateStr >= r.from && (r.to === null || r.to === undefined || dateStr <= r.to));
}

function isDueOn(obligation, dateStr) {
  if (dateStr < obligation.createdDate) return false;
  if (isPausedOn(obligation, dateStr)) return false;
  if (obligation.type === "once") return dateStr === obligation.createdDate;
  if (obligation.type === "ongoing") return true;
  if (obligation.type === "weekday") return (obligation.weekdays || []).indexOf(dowKey(dateStr)) !== -1;
  if (obligation.type === "course") {
    const countBefore = obligation.completions.filter((d) => d < dateStr).length;
    return countBefore < obligation.courseTotal;
  }
  return false;
}
function isDoneOn(obligation, dateStr) {
  return obligation.completions.indexOf(dateStr) !== -1;
}

function dayStats(obligations, dateStr) {
  let due = 0, done = 0;
  obligations.forEach((o) => {
    if (isDueOn(o, dateStr)) {
      due++;
      if (isDoneOn(o, dateStr)) done++;
    }
  });
  return { due, done };
}

function computeHealthPercent(obligations, todayStr) {
  let due = 0, done = 0;
  [0, -1, -2].forEach((off) => {
    const s = dayStats(obligations, addDays(todayStr, off));
    due += s.due;
    done += s.done;
  });
  if (due === 0) return 100;
  return Math.round((done / due) * 100);
}
function healthState(pct) {
  if (pct >= 90) return "bloom";
  if (pct >= 50) return "normal";
  if (pct >= 20) return "wilt";
  return "wilt-severe";
}

function computeStreak(obligations, todayStr) {
  let streak = 0;
  const todayStats = dayStats(obligations, todayStr);
  if (todayStats.due > 0 && todayStats.done >= todayStats.due) streak++;

  let cursor = addDays(todayStr, -1);
  while (true) {
    const s = dayStats(obligations, cursor);
    if (s.due === 0) break;
    if (s.done >= s.due) {
      streak++;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

// How a course's progress should read depends on how long it is - a 7-day
// course reads fine as a plain day counter, but a 90-day course counted in
// days feels endless, so it switches to weeks; and a mid-length course gets
// a couple of milestone reactions along the way instead of only at the end.
function courseLengthTier(courseTotal) {
  if (courseTotal <= 14) return "short";
  if (courseTotal <= 30) return "medium";
  return "long";
}

// progress/courseTotal are day counts (progress = completions so far).
// Returns null, or the milestone this exact completion just reached -
// { type: "percent", value: 25|50|75 } for medium courses, or
// { type: "week", week } for long ones (every 7th completion, excluding the
// final day - that's covered by the separate "course finished" celebration).
function courseMilestoneForProgress(progress, courseTotal) {
  const tier = courseLengthTier(courseTotal);
  if (tier === "medium") {
    const thresholds = [
      [25, Math.round(courseTotal * 0.25)],
      [50, Math.round(courseTotal * 0.5)],
      [75, Math.round(courseTotal * 0.75)],
    ];
    const hit = thresholds.find(([, day]) => day > 0 && day < courseTotal && day === progress);
    return hit ? { type: "percent", value: hit[0] } : null;
  }
  if (tier === "long") {
    if (progress > 0 && progress < courseTotal && progress % 7 === 0) {
      return { type: "week", week: progress / 7 };
    }
    return null;
  }
  return null;
}

function weeklyStats(obligations, todayStr) {
  let due = 0, done = 0;
  for (let i = 0; i < 7; i++) {
    const s = dayStats(obligations, addDays(todayStr, -i));
    due += s.due;
    done += s.done;
  }
  return { due, done };
}

module.exports = {
  formatDate,
  realTodayStr,
  addDays,
  dowKey,
  isPausedOn,
  isDueOn,
  isDoneOn,
  dayStats,
  computeHealthPercent,
  healthState,
  computeStreak,
  weeklyStats,
  courseLengthTier,
  courseMilestoneForProgress,
};
