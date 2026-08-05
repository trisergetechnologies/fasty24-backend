/**
 * Instant Maid catalog — time-based tiers.
 * The customer buys a block of a verified maid's time rather than a specific
 * cleaning area, so every tier shares the same inclusions and exclusions.
 * Shared by seed.js and migrate-maid-tiers.js.
 */

const MAID_CATEGORY_DESCRIPTION =
  "Book a verified maid by the hour — utensils, mopping, dusting and daily household work.";

const MAID_INCLUSIONS = [
  "Utensil washing and kitchen platform cleaning",
  "Sweeping and mopping (jhadu-poncha)",
  "Dusting of furniture and surfaces",
  "Basic bathroom cleaning",
  "Vegetable chopping and basic kitchen prep",
  "General household tidying and organising",
  "Verified professional, OTP-secured start and finish",
];

const MAID_EXCLUSIONS = [
  "Hard stain and scrub removal",
  "Wall and floor tile cleaning",
  "Full deep bathroom cleaning",
  "Full wardrobe sorting and setting",
  "Cooking full meals",
  "Cleaning materials, detergents and supplies",
];

const MAID_TIERS = [
  { min: 30, name: "30 Minutes", label: "30 minutes", price: 99 },
  { min: 60, name: "1 Hour", label: "1 hour", price: 149 },
  { min: 90, name: "1.5 Hours", label: "1.5 hours", price: 219 },
  { min: 120, name: "2 Hours", label: "2 hours", price: 279 },
].map(({ min, name, label, price }) => ({
  slug: `maid-${min}m`,
  name,
  categories: ["instant-maid"],
  skillTag: "instant_maid",
  serviceKind: "timed",
  durationMin: min,
  price,
  addOnEligible: false,
  shortDescription: `A verified maid for ${label} of household work — utensils, mopping, dusting and more.`,
  description: `Book a background-verified maid for ${label} with Fasty-24. This is a time-based service — tell the professional what matters most to you and she works through it within the booked time. Utensils, sweeping, mopping, dusting, basic bathroom cleaning and vegetable chopping are all covered. Every job is OTP-secured at the start and finish.`,
  inclusions: MAID_INCLUSIONS,
  exclusions: MAID_EXCLUSIONS,
}));

module.exports = {
  MAID_TIERS,
  MAID_INCLUSIONS,
  MAID_EXCLUSIONS,
  MAID_CATEGORY_DESCRIPTION,
};
