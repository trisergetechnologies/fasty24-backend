require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Service = require("../models/Service");
const geo = require("../services/geo");
const env = require("../config/env");

/**
 * Non-destructive price update script.
 * - Updates prices on existing services (does not wipe any data).
 * - Adds missing maid 120-min and 150-min tiers.
 * - Adds Electrician and Plumber categories + services if not present.
 * Run: node src/scripts/update-prices.js
 */

// Price changes based on real pricing sheet
const PRICE_UPDATES = [
  // AC
  { slug: "ac-repair",           price: 399,  durationMin: 45 },  // AC General Service
  { slug: "ac-jet-service",      price: 599,  durationMin: 60 },  // AC Jet Wash
  { slug: "ac-install",          price: 1299, durationMin: 120 }, // AC Installation
  { slug: "ac-uninstall",        price: 699,  durationMin: 90 },
  { slug: "window-ac-install",   price: 999,  durationMin: 90 },
  { slug: "window-ac-uninstall", price: 599,  durationMin: 60 },
  { slug: "ac-gas-filling",      price: 2199, durationMin: 45 },  // AC Gas Refill (excl. gas cost)
  { slug: "ac-zero-cooling",     price: 399,  durationMin: 60 },
  { slug: "ac-power-issue",      price: 399,  durationMin: 45 },
  { slug: "ac-noise-smell",      price: 399,  durationMin: 45 },
  { slug: "ac-water-leak",       price: 399,  durationMin: 45 },
  // Chimney
  { slug: "chimney-basic", price: 599, durationMin: 45 }, // Kitchen/Chimney Cleaning
  { slug: "chimney-deep",  price: 899, durationMin: 90 },
  // RO
  { slug: "ro-repair-checkup",    price: 299, durationMin: 45 }, // RO Service
  { slug: "ro-filter-checkup",    price: 199, durationMin: 30 },
  { slug: "ro-filter-replacement",price: 999, durationMin: 45 }, // RO Filter Change (standard set)
  { slug: "ro-install",           price: 599, durationMin: 90 },
  { slug: "ro-uninstall",         price: 399, durationMin: 60 },
  // Fridge
  { slug: "fridge-clean-single",     price: 499, durationMin: 60 },
  { slug: "fridge-clean-double",     price: 599, durationMin: 60 },
  { slug: "fridge-clean-side-by-side", price: 699, durationMin: 75 },
  { slug: "fridge-clean-triple",     price: 799, durationMin: 90 },
  { slug: "fridge-checkup-single",   price: 349, durationMin: 45 }, // Refrigerator Service
  { slug: "fridge-checkup-double",   price: 349, durationMin: 45 },
  { slug: "fridge-checkup-side-by-side", price: 349, durationMin: 45 },
  { slug: "fridge-checkup-triple",   price: 349, durationMin: 45 },
  { slug: "fridge-no-power",    price: 349, durationMin: 45 },
  { slug: "fridge-no-cooling",  price: 349, durationMin: 45 },
  { slug: "fridge-excess-cooling", price: 349, durationMin: 45 },
  { slug: "fridge-water-leakage",  price: 349, durationMin: 45 },
  { slug: "fridge-door-issue",     price: 349, durationMin: 45 },
  { slug: "fridge-noise-issue",    price: 349, durationMin: 45 },
  // Maid — align to pricing sheet (1hr=149, 2hr=279, 2.5hr=349)
  { slug: "maid-home-30m",     price: 99,  durationMin: 30 },
  { slug: "maid-home-45m",     price: 129, durationMin: 45 },
  { slug: "maid-home-60m",     price: 149, durationMin: 60 },
  { slug: "maid-kitchen-30m",  price: 99,  durationMin: 30 },
  { slug: "maid-kitchen-45m",  price: 129, durationMin: 45 },
  { slug: "maid-kitchen-60m",  price: 149, durationMin: 60 },
  { slug: "maid-utensils-30m", price: 99,  durationMin: 30 },
  { slug: "maid-utensils-45m", price: 129, durationMin: 45 },
  { slug: "maid-bathroom-30m", price: 99,  durationMin: 30 },
  { slug: "maid-bathroom-45m", price: 129, durationMin: 45 },
  { slug: "maid-bathroom-60m", price: 149, durationMin: 60 }, // Bathroom Cleaning ₹499... but maid model is timed
];

// New maid tiers matching "2 HOURS = ₹279" and "2.5 HOURS = ₹349"
const NEW_MAID_SERVICES = [
  { slug: "maid-home-120m",     name: "Home Cleaning (2 hrs)",     price: 279, durationMin: 120 },
  { slug: "maid-home-150m",     name: "Home Cleaning (2.5 hrs)",   price: 349, durationMin: 150 },
  { slug: "maid-kitchen-120m",  name: "Kitchen Cleaning (2 hrs)",  price: 279, durationMin: 120 },
  { slug: "maid-kitchen-150m",  name: "Kitchen Cleaning (2.5 hrs)",price: 349, durationMin: 150 },
  { slug: "maid-bathroom-120m", name: "Bathroom Cleaning (2 hrs)", price: 279, durationMin: 120 },
  { slug: "maid-bathroom-150m", name: "Bathroom Cleaning (2.5 hrs)",price: 349, durationMin: 150 },
].map((s) => ({
  ...s,
  categories: ["instant-maid"],
  skillTag: "instant_maid",
  serviceKind: "timed",
  addOnEligible: false,
  shortDescription: `${s.name} by background-verified professionals.`,
  description: `Book ${s.name} with Fasty-24. Our trained professionals arrive in 15-20 minutes. OTP-secured and backed by our service guarantee.`,
  imageUrl: "",
  gallery: [],
  process: [],
  inclusions: ["Verified professional", "OTP-verified completion", "Upfront, transparent pricing"],
  exclusions: ["Cleaning materials & supplies", "Dishwashing soap / detergents"],
  faqs: [],
  active: true,
}));

// New categories and services
const NEW_CATEGORIES = [
  {
    slug: "electrician",
    name: "Electrician",
    description: "Wiring, fitting, fan installation and electrical repairs.",
    icon: "⚡",
    imageUrl: "",
    sortOrder: 6,
    supportsScheduling: true,
    supportsTimedJob: false,
    active: true,
  },
  {
    slug: "plumber",
    name: "Plumber",
    description: "Pipe repairs, tap fitting, drainage and plumbing services.",
    icon: "🔧",
    imageUrl: "",
    sortOrder: 7,
    supportsScheduling: true,
    supportsTimedJob: false,
    active: true,
  },
];

const NEW_SERVICES = [
  {
    slug: "electrician-visit",
    name: "Electrician Visit",
    categories: ["electrician"],
    skillTag: "electrician",
    durationMin: 30,
    price: 149,
    addOnEligible: true,
    serviceKind: "standard",
    shortDescription: "Electrician inspection visit (visit charge only).",
    description: "Book an electrician visit with Fasty-24. Our verified electrician will inspect the issue and provide a quote for any repair work needed. Visit charge only — materials billed separately.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified electrician", "Issue inspection", "Repair estimate", "OTP-secured", "Upfront visit charge"],
    exclusions: ["Materials & wiring cost", "Heavy fixture purchases", "Repair labour beyond inspection"],
    faqs: [],
    active: true,
  },
  {
    slug: "electrician-fan-install",
    name: "Fan Installation",
    categories: ["electrician"],
    skillTag: "electrician",
    durationMin: 45,
    price: 249,
    addOnEligible: true,
    serviceKind: "standard",
    shortDescription: "Ceiling or wall fan installation by a verified electrician.",
    description: "Professional fan installation. Expert brings tools; fan must be provided by customer.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified electrician", "Fan fitting & wiring", "OTP-secured completion"],
    exclusions: ["Fan not included", "Wiring extension charges", "Switchboard changes"],
    faqs: [],
    active: true,
  },
  {
    slug: "electrician-switch-repair",
    name: "Switch / Socket Repair",
    categories: ["electrician"],
    skillTag: "electrician",
    durationMin: 30,
    price: 199,
    addOnEligible: true,
    serviceKind: "standard",
    shortDescription: "Switch box, socket, or MCB repair.",
    description: "Repair of faulty switches, sockets, or MCB. Material cost billed separately.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified electrician", "Diagnosis & repair", "OTP-secured"],
    exclusions: ["Switch / socket material cost", "New wiring"],
    faqs: [],
    active: true,
  },
  {
    slug: "plumber-visit",
    name: "Plumber Visit",
    categories: ["plumber"],
    skillTag: "plumber",
    durationMin: 30,
    price: 149,
    addOnEligible: true,
    serviceKind: "standard",
    shortDescription: "Plumber inspection visit (visit charge only).",
    description: "Book a plumber visit with Fasty-24. Our verified plumber will inspect the issue and provide a repair estimate. Visit charge only — materials billed separately.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified plumber", "Issue inspection", "Repair estimate", "OTP-secured", "Upfront visit charge"],
    exclusions: ["Pipe and fitting materials", "Fixture purchases", "Labour beyond inspection"],
    faqs: [],
    active: true,
  },
  {
    slug: "plumber-tap-repair",
    name: "Tap / Faucet Repair",
    categories: ["plumber"],
    skillTag: "plumber",
    durationMin: 45,
    price: 199,
    addOnEligible: true,
    serviceKind: "standard",
    shortDescription: "Leaking or broken tap repair by a verified plumber.",
    description: "Fix dripping or broken taps and faucets. Material cost billed separately if replacement parts are needed.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified plumber", "Diagnosis & repair", "OTP-secured"],
    exclusions: ["Replacement tap / faucet cost", "Pipe rerouting"],
    faqs: [],
    active: true,
  },
  {
    slug: "plumber-drain-cleaning",
    name: "Drain Cleaning",
    categories: ["plumber"],
    skillTag: "plumber",
    durationMin: 60,
    price: 299,
    addOnEligible: false,
    serviceKind: "standard",
    shortDescription: "Kitchen, bathroom or floor drain unblocking.",
    description: "Professional drain unblocking for kitchen, bathroom, or floor drains. Tools and basic chemicals included.",
    imageUrl: "",
    gallery: [],
    process: [],
    inclusions: ["Verified plumber", "Basic unblocking chemicals", "OTP-secured"],
    exclusions: ["Major pipe replacement", "Tile or floor work"],
    faqs: [],
    active: true,
  },
];

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("[update-prices] connected");

  // 1. Update prices on existing services
  let updated = 0;
  for (const { slug, price, durationMin } of PRICE_UPDATES) {
    const result = await Service.updateOne({ slug }, { $set: { price, durationMin } });
    if (result.modifiedCount > 0) {
      console.log(`[update-prices] ${slug} → ₹${price} (${durationMin}min)`);
      updated++;
    }
  }
  console.log(`[update-prices] ${updated} services updated`);

  // 2. Upsert new maid tiers (insert if not existing)
  let newMaidInserted = 0;
  for (const svc of NEW_MAID_SERVICES) {
    const exists = await Service.findOne({ slug: svc.slug });
    if (!exists) {
      await Service.create(svc);
      console.log(`[update-prices] inserted new maid service: ${svc.slug}`);
      newMaidInserted++;
    }
  }
  console.log(`[update-prices] ${newMaidInserted} new maid tiers inserted`);

  // 3. Upsert new categories
  let newCatInserted = 0;
  for (const cat of NEW_CATEGORIES) {
    const exists = await Category.findOne({ slug: cat.slug });
    if (!exists) {
      await Category.create(cat);
      console.log(`[update-prices] inserted category: ${cat.slug}`);
      newCatInserted++;
    }
  }
  console.log(`[update-prices] ${newCatInserted} new categories inserted`);

  // 4. Upsert new services
  let newSvcInserted = 0;
  for (const svc of NEW_SERVICES) {
    const exists = await Service.findOne({ slug: svc.slug });
    if (!exists) {
      await Service.create(svc);
      console.log(`[update-prices] inserted service: ${svc.slug}`);
      newSvcInserted++;
    }
  }
  console.log(`[update-prices] ${newSvcInserted} new services inserted`);

  // 5. Also upsert exclusions on existing services that have none
  const exclusionDefaults = [
    { skillTag: "ac_service",   exclusions: ["Spare parts & gas cost", "Electrical wiring work"] },
    { slug: "ac-gas-filling",   exclusions: ["Gas cost not included (charged separately)", "Compressor repair not included"] },
    { skillTag: "ro_service",   exclusions: ["Filter and membrane cost (for replacements)", "Plumbing pipe changes"] },
    { skillTag: "chimney",      exclusions: ["Motor/PCB replacement cost", "Physical damage repair"] },
    { skillTag: "fridge",       exclusions: ["Spare parts & refrigerant cost", "Physical damage repair"] },
    { skillTag: "instant_maid", exclusions: ["Cleaning materials & supplies", "Dishwashing soap / detergents"] },
  ];

  for (const rule of exclusionDefaults) {
    const filter = rule.slug
      ? { slug: rule.slug, $or: [{ exclusions: { $exists: false } }, { exclusions: { $size: 0 } }] }
      : { skillTag: rule.skillTag, $or: [{ exclusions: { $exists: false } }, { exclusions: { $size: 0 } }] };
    const result = await Service.updateMany(filter, { $set: { exclusions: rule.exclusions } });
    if (result.modifiedCount > 0) {
      console.log(`[update-prices] set exclusions for ${result.modifiedCount} ${rule.slug || rule.skillTag} services`);
    }
  }

  await mongoose.disconnect();
  console.log("[update-prices] done");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
