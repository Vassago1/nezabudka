"use strict";

// Server-side source of truth for what a species costs / how it's earned,
// and what each achievement requires. Display text (title, description,
// icon) lives client-side next to the rest of the UI copy - the server only
// needs to validate purchases and evaluate unlock conditions.

// "kind" is the companion type (plant/cat/dog) a species belongs to - purely
// presentational (drives which SVG rig + palette the client renders), but
// centralized here so the client derives "current companion type" from
// activeSpeciesId instead of needing its own stored field.
const SPECIES = [
  { id: "default", cost: 0, rare: false, kind: "plant" }, // starter plant, owned by every patient
  { id: "fern", cost: 55, rare: false, kind: "plant" },
  { id: "cactus", cost: 70, rare: false, kind: "plant" },
  { id: "ivy", cost: 65, rare: false, kind: "plant" },
  { id: "succulent", cost: 50, rare: false, kind: "plant" },
  { id: "rare_gold_30", cost: null, rare: true, streakThreshold: 30, kind: "plant" },
  { id: "rare_gold_60", cost: null, rare: true, streakThreshold: 60, kind: "plant" },
  { id: "rare_gold_100", cost: null, rare: true, streakThreshold: 100, kind: "plant" },
  // Alternate starter companions, chosen once at patient creation (or later
  // from the collection screen). Free and always owned, same as "default" -
  // see STARTER_SPECIES_IDS below.
  { id: "cat_default", cost: 0, rare: false, kind: "cat" },
  { id: "dog_default", cost: 0, rare: false, kind: "dog" },
  { id: "dragon_default", cost: 0, rare: false, kind: "dragon" },
  { id: "seal_default", cost: 0, rare: false, kind: "seal" },
];

// Free companions every patient owns without a patient_species row - see
// store.js getOwnedSpeciesIds, which force-includes these ids.
const STARTER_SPECIES_IDS = ["default", "cat_default", "dog_default", "dragon_default", "seal_default"];

const PURCHASABLE_SPECIES_IDS = SPECIES.filter(
  (s) => !s.rare && STARTER_SPECIES_IDS.indexOf(s.id) === -1
).map((s) => s.id);
const RARE_SPECIES = SPECIES.filter((s) => s.rare);

const SCENE_IDS = ["windowsill", "greenhouse", "balcony"];

// Achievements with a streak-threshold condition; "first_week" and
// "streak_7" intentionally share the same trigger (7-day streak) - they're
// framed differently in the UI but there's no reason to hide one of them
// once the other unlocks.
const STREAK_ACHIEVEMENTS = [
  { id: "first_week", streakAtLeast: 7 },
  { id: "streak_3", streakAtLeast: 3 },
  { id: "streak_7", streakAtLeast: 7 },
  { id: "streak_14", streakAtLeast: 14 },
  { id: "streak_30", streakAtLeast: 30 },
];

// Achievements gated on a fact other than streak length, evaluated by
// store.evaluateProgress against the patient's current state.
const FACT_ACHIEVEMENT_IDS = [
  "first_course",
  "doctor_connected",
  "mood_diary_shared",
  "species_collector",
  "time_traveler",
];

const ALL_ACHIEVEMENT_IDS = STREAK_ACHIEVEMENTS.map((a) => a.id).concat(FACT_ACHIEVEMENT_IDS);

function findSpecies(speciesId) {
  return SPECIES.find((s) => s.id === speciesId) || null;
}

module.exports = {
  SPECIES,
  STARTER_SPECIES_IDS,
  PURCHASABLE_SPECIES_IDS,
  RARE_SPECIES,
  SCENE_IDS,
  STREAK_ACHIEVEMENTS,
  FACT_ACHIEVEMENT_IDS,
  ALL_ACHIEVEMENT_IDS,
  findSpecies,
};
