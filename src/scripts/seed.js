require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Service = require("../models/Service");
const Expert = require("../models/Expert");
const User = require("../models/User");
const Zone = require("../models/Zone");
const env = require("../config/env");
const geo = require("../services/geo");

const CATEGORIES = [
  { slug: "instant-maid", name: "Instant Maid", description: "Home, kitchen, utensils and bathroom cleaning on demand.", icon: "🧹", sortOrder: 1, supportsScheduling: false, supportsTimedJob: true },
  { slug: "ac-service",   name: "AC Service & Repair", description: "Servicing, repair, installation and gas filling.", icon: "❄️", sortOrder: 2, supportsScheduling: true, supportsTimedJob: false },
  { slug: "chimney",      name: "Chimney Service", description: "Deep and basic chimney cleaning.", icon: "🔥", sortOrder: 3, supportsScheduling: true, supportsTimedJob: false },
  { slug: "ro-service",   name: "RO Service & Repair", description: "Repair, filter and installation services.", icon: "💧", sortOrder: 4, supportsScheduling: true, supportsTimedJob: false },
  { slug: "fridge",       name: "Refrigerator", description: "Cleaning, checkup and repair for all door types.", icon: "🧊", sortOrder: 5, supportsScheduling: true, supportsTimedJob: false },
  { slug: "electrician",  name: "Electrician", description: "Wiring, fitting, fan installation and electrical repairs.", icon: "⚡", sortOrder: 6, supportsScheduling: true, supportsTimedJob: false },
  { slug: "plumber",      name: "Plumber", description: "Pipe repairs, tap fitting, drainage and plumbing services.", icon: "🔧", sortOrder: 7, supportsScheduling: true, supportsTimedJob: false },
];

function maidServices() {
  // Pricing sheet: 1hr=₹149, 2hr=₹279, 2.5hr=₹349
  const MAID_PRICES = { 30: 99, 45: 129, 60: 149, 120: 279, 150: 349 };
  const areas = [
    { prefix: "home",     label: "Home Cleaning" },
    { prefix: "kitchen",  label: "Kitchen Cleaning" },
    { prefix: "utensils", label: "Utensils Cleaning" },
    { prefix: "bathroom", label: "Bathroom Cleaning" },
  ];
  const out = [];
  for (const area of areas) {
    const durs = area.prefix === "utensils" ? [30, 45] : [30, 45, 60, 120, 150];
    for (const min of durs) {
      out.push({
        slug: `maid-${area.prefix}-${min}m`,
        name: `${area.label} (${min >= 60 ? min / 60 + " hr" : min + " min"})`,
        categories: ["instant-maid"],
        skillTag: "instant_maid",
        serviceKind: "timed",
        durationMin: min,
        price: MAID_PRICES[min] ?? 149,
        addOnEligible: false,
      });
    }
  }
  return out;
}

const SERVICES = [
  ...maidServices(),
  // AC — pricing sheet aligned
  { slug: "ac-repair",           name: "AC General Service",    categories: ["ac-service"], skillTag: "ac_service", durationMin: 45,  price: 399,  addOnEligible: true  },
  { slug: "ac-jet-service",      name: "AC Jet Wash Service",   categories: ["ac-service"], skillTag: "ac_service", durationMin: 60,  price: 599,  addOnEligible: true  },
  { slug: "ac-install",          name: "AC Installation",       categories: ["ac-service"], skillTag: "ac_service", durationMin: 120, price: 1299, addOnEligible: false },
  { slug: "ac-uninstall",        name: "AC Uninstallation",     categories: ["ac-service"], skillTag: "ac_service", durationMin: 90,  price: 699,  addOnEligible: false },
  { slug: "window-ac-install",   name: "Window AC Installation",categories: ["ac-service"], skillTag: "ac_service", durationMin: 90,  price: 999,  addOnEligible: false },
  { slug: "window-ac-uninstall", name: "Window AC Uninstallation", categories: ["ac-service"], skillTag: "ac_service", durationMin: 60, price: 599, addOnEligible: false },
  { slug: "ac-gas-filling",      name: "AC Gas Refill",         categories: ["ac-service"], skillTag: "ac_service", durationMin: 45,  price: 2199, addOnEligible: true  },
  { slug: "ac-zero-cooling",     name: "Less/Zero Cooling",     categories: ["ac-service"], skillTag: "ac_service", durationMin: 60,  price: 399,  addOnEligible: true  },
  { slug: "ac-power-issue",      name: "AC Power Issue",        categories: ["ac-service"], skillTag: "ac_service", durationMin: 45,  price: 399,  addOnEligible: true  },
  { slug: "ac-noise-smell",      name: "Unwanted Noise/Smell",  categories: ["ac-service"], skillTag: "ac_service", durationMin: 45,  price: 399,  addOnEligible: true  },
  { slug: "ac-water-leak",       name: "AC Water Leakage",      categories: ["ac-service"], skillTag: "ac_service", durationMin: 45,  price: 399,  addOnEligible: true  },
  // Chimney
  { slug: "chimney-basic", name: "Chimney Cleaning",      categories: ["chimney"], skillTag: "chimney", durationMin: 45, price: 599, addOnEligible: false },
  { slug: "chimney-deep",  name: "Deep Chimney Service",  categories: ["chimney"], skillTag: "chimney", durationMin: 90, price: 899, addOnEligible: false },
  // RO
  { slug: "ro-repair-checkup",     name: "RO Service & Check-up",   categories: ["ro-service"], skillTag: "ro_service", durationMin: 45, price: 299,  addOnEligible: true  },
  { slug: "ro-filter-checkup",     name: "RO Filter Check-up",      categories: ["ro-service"], skillTag: "ro_service", durationMin: 30, price: 199,  addOnEligible: true  },
  { slug: "ro-filter-replacement", name: "RO Filter Replacement",   categories: ["ro-service"], skillTag: "ro_service", durationMin: 45, price: 999,  addOnEligible: true  },
  { slug: "ro-install",            name: "RO Installation",         categories: ["ro-service"], skillTag: "ro_service", durationMin: 90, price: 599,  addOnEligible: false },
  { slug: "ro-uninstall",          name: "RO Uninstallation",       categories: ["ro-service"], skillTag: "ro_service", durationMin: 60, price: 399,  addOnEligible: false },
  // Refrigerator — ₹349 base per pricing sheet
  ...["single", "double", "side-by-side", "triple"].flatMap((door) => [
    { slug: `fridge-clean-${door}`,   name: `Fridge Cleaning (${door.replace(/-/g, " ")})`, categories: ["fridge"], skillTag: "fridge", durationMin: door === "triple" ? 90 : door === "side-by-side" ? 75 : 60, price: door === "single" ? 499 : door === "double" ? 599 : door === "side-by-side" ? 699 : 799, addOnEligible: false },
    { slug: `fridge-checkup-${door}`, name: `Fridge Checkup (${door.replace(/-/g, " ")})`, categories: ["fridge"], skillTag: "fridge", durationMin: 45, price: 349, addOnEligible: true },
  ]),
  ...["no-power", "no-cooling", "excess-cooling", "water-leakage", "door-issue", "noise-issue"].map((issue) => ({
    slug: `fridge-${issue}`, name: `Fridge ${issue.replace(/-/g, " ")}`, categories: ["fridge"], skillTag: "fridge", durationMin: 45, price: 349, addOnEligible: true,
  })),
  // Electrician
  { slug: "electrician-visit",        name: "Electrician Visit",      categories: ["electrician"], skillTag: "electrician", durationMin: 30, price: 149, addOnEligible: true },
  { slug: "electrician-fan-install",  name: "Fan Installation",       categories: ["electrician"], skillTag: "electrician", durationMin: 45, price: 249, addOnEligible: true },
  { slug: "electrician-switch-repair",name: "Switch / Socket Repair", categories: ["electrician"], skillTag: "electrician", durationMin: 30, price: 199, addOnEligible: true },
  // Plumber
  { slug: "plumber-visit",        name: "Plumber Visit",      categories: ["plumber"], skillTag: "plumber", durationMin: 30, price: 149, addOnEligible: true },
  { slug: "plumber-tap-repair",   name: "Tap / Faucet Repair",categories: ["plumber"], skillTag: "plumber", durationMin: 45, price: 199, addOnEligible: true },
  { slug: "plumber-drain-cleaning",name: "Drain Cleaning",    categories: ["plumber"], skillTag: "plumber", durationMin: 60, price: 299, addOnEligible: false },
];

async function seed() {
  await mongoose.connect(env.MONGO_URI);
  console.log("[seed] clearing collections...");
  await Promise.all([
    Category.deleteMany({}),
    Service.deleteMany({}),
    Expert.deleteMany({}),
    User.deleteMany({}),
    Zone.deleteMany({}),
  ]);

  await Category.insertMany(CATEGORIES);
  function getExclusions(s) {
    if (s.exclusions) return s.exclusions;
    if (s.slug === "ac-gas-filling") return ["Gas cost not included (charged separately)", "Compressor repair not included"];
    if (s.skillTag === "ac_service") return ["Spare parts & gas cost", "Electrical wiring work"];
    if (s.skillTag === "ro_service") return ["Filter and membrane cost (for replacements)", "Plumbing pipe changes"];
    if (s.skillTag === "chimney") return ["Motor/PCB replacement cost", "Physical damage repair"];
    if (s.skillTag === "fridge") return ["Spare parts & refrigerant cost", "Physical damage repair"];
    if (s.skillTag === "instant_maid") return ["Cleaning materials & supplies", "Dishwashing soap / detergents"];
    if (s.skillTag === "electrician") return ["Materials & wiring cost", "Heavy fixture purchases"];
    if (s.skillTag === "plumber") return ["Pipe and fitting materials", "Fixture purchases"];
    return [];
  }

  await Service.insertMany(
    SERVICES.map((s) => ({
      ...s,
      shortDescription:
        s.shortDescription || `${s.name} by background-verified professionals.`,
      description:
        s.description ||
        `Book ${s.name} with Fasty-24. Our trained professionals arrive in 15-20 minutes with genuine parts and transparent, upfront pricing. Every job is OTP-secured at the start and finish, and backed by our service guarantee.`,
      imageUrl: "",
      gallery: [],
      process: [],
      inclusions: s.inclusions || [
        "Verified professional",
        "Genuine parts & materials",
        "OTP-verified completion",
        "Upfront, transparent pricing",
      ],
      exclusions: getExclusions(s),
      faqs: [],
      active: true,
      serviceKind: s.serviceKind || "standard",
    }))
  );

  // Vaishali, Ghaziabad — 7 km service radius
  const VAISHALI_CENTER = { lat: 28.6517, lng: 77.3395 };
  const SERVICE_RADIUS_M = 7000;
  const k = geo.kForRadiusMeters(SERVICE_RADIUS_M);
  const h3Cells = geo.ringCells(VAISHALI_CENTER.lat, VAISHALI_CENTER.lng, k);
  const degPerKm = 1 / 111;
  const radiusDeg = (SERVICE_RADIUS_M / 1000) * degPerKm;
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [VAISHALI_CENTER.lng - radiusDeg, VAISHALI_CENTER.lat - radiusDeg],
        [VAISHALI_CENTER.lng + radiusDeg, VAISHALI_CENTER.lat - radiusDeg],
        [VAISHALI_CENTER.lng + radiusDeg, VAISHALI_CENTER.lat + radiusDeg],
        [VAISHALI_CENTER.lng - radiusDeg, VAISHALI_CENTER.lat + radiusDeg],
        [VAISHALI_CENTER.lng - radiusDeg, VAISHALI_CENTER.lat - radiusDeg],
      ],
    ],
  };
  await Zone.create({
    slug: "vaishali-ghaziabad",
    name: "Vaishali, Ghaziabad",
    city: "Ghaziabad",
    polygon,
    h3Cells,
    active: true,
  });

  await User.create({ phone: "+919999999999", name: "Demo Customer", gender: "male", dateOfBirth: new Date("1990-01-01") });

  const center = VAISHALI_CENTER;
  const skills = ["instant_maid", "ac_service", "chimney", "ro_service", "fridge"];
  for (let i = 0; i < 8; i++) {
    const lat = center.lat + (Math.random() - 0.5) * 0.04;
    const lng = center.lng + (Math.random() - 0.5) * 0.04;
    await Expert.create({
      phone: `+91987654320${i}`,
      name: `Expert ${i + 1}`,
      skills: skills.slice(0, 2 + (i % 3)),
      status: i < 5 ? "online" : "offline",
      lastLocation: { lat, lng, updatedAt: new Date() },
      h3Index: geo.toCell(lat, lng),
      kycStatus: "verified",
      trainingStatus: "completed",
    });
  }

  console.log(`[seed] ${CATEGORIES.length} categories, ${SERVICES.length} services, zone + experts ready`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
