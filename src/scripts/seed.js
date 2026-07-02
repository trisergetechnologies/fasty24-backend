require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const h3 = require("h3-js");
const Category = require("../models/Category");
const Service = require("../models/Service");
const Expert = require("../models/Expert");
const User = require("../models/User");
const Zone = require("../models/Zone");
const env = require("../config/env");
const geo = require("../services/geo");

const CATEGORIES = [
  {
    slug: "instant-maid",
    name: "Instant Maid",
    description: "Home, kitchen, utensils and bathroom cleaning on demand.",
    icon: "🧹",
    sortOrder: 1,
    supportsScheduling: false,
    supportsTimedJob: true,
  },
  {
    slug: "ac-service",
    name: "AC Service & Repair",
    description: "Servicing, repair, installation and gas filling.",
    icon: "❄️",
    sortOrder: 2,
    supportsScheduling: true,
    supportsTimedJob: false,
  },
  {
    slug: "chimney",
    name: "Chimney Service",
    description: "Deep and basic chimney cleaning.",
    icon: "🔥",
    sortOrder: 3,
    supportsScheduling: true,
    supportsTimedJob: false,
  },
  {
    slug: "ro-service",
    name: "RO Service & Repair",
    description: "Repair, filter and installation services.",
    icon: "💧",
    sortOrder: 4,
    supportsScheduling: true,
    supportsTimedJob: false,
  },
  {
    slug: "fridge",
    name: "Refrigerator",
    description: "Cleaning, checkup and repair for all door types.",
    icon: "🧊",
    sortOrder: 5,
    supportsScheduling: true,
    supportsTimedJob: false,
  },
];

function maidServices() {
  const areas = [
    { prefix: "home", label: "Home Cleaning" },
    { prefix: "kitchen", label: "Kitchen Cleaning" },
    { prefix: "utensils", label: "Utensils Cleaning" },
    { prefix: "bathroom", label: "Bathroom Cleaning" },
  ];
  const durations = areas[2].prefix === "utensils" ? [30, 45] : [30, 45, 60];
  const out = [];
  for (const area of areas) {
    const durs = area.prefix === "utensils" ? [30, 45] : [30, 45, 60];
    for (const min of durs) {
      out.push({
        slug: `maid-${area.prefix}-${min}m`,
        name: `${area.label} (${min} min)`,
        categories: ["instant-maid"],
        skillTag: "instant_maid",
        serviceKind: "timed",
        durationMin: min,
        price: 199 + min * 4,
        addOnEligible: false,
      });
    }
  }
  return out;
}

const SERVICES = [
  ...maidServices(),
  { slug: "ac-jet-service", name: "Jet AC Servicing", categories: ["ac-service"], skillTag: "ac_service", durationMin: 60, price: 499, addOnEligible: true },
  { slug: "ac-repair", name: "AC Repair", categories: ["ac-service"], skillTag: "ac_service", durationMin: 60, price: 399, addOnEligible: true },
  { slug: "ac-install", name: "AC Installation", categories: ["ac-service"], skillTag: "ac_service", durationMin: 120, price: 1499, addOnEligible: false },
  { slug: "ac-uninstall", name: "AC Uninstallation", categories: ["ac-service"], skillTag: "ac_service", durationMin: 90, price: 699, addOnEligible: false },
  { slug: "window-ac-install", name: "Window AC Installation", categories: ["ac-service"], skillTag: "ac_service", durationMin: 90, price: 999, addOnEligible: false },
  { slug: "window-ac-uninstall", name: "Window AC Uninstallation", categories: ["ac-service"], skillTag: "ac_service", durationMin: 60, price: 599, addOnEligible: false },
  { slug: "ac-zero-cooling", name: "Less/Zero Cooling", categories: ["ac-service"], skillTag: "ac_service", durationMin: 60, price: 449, addOnEligible: true },
  { slug: "ac-power-issue", name: "AC Power Issue", categories: ["ac-service"], skillTag: "ac_service", durationMin: 45, price: 399, addOnEligible: true },
  { slug: "ac-noise-smell", name: "Unwanted Noise/Smell", categories: ["ac-service"], skillTag: "ac_service", durationMin: 45, price: 399, addOnEligible: true },
  { slug: "ac-water-leak", name: "AC Water Leakage", categories: ["ac-service"], skillTag: "ac_service", durationMin: 45, price: 399, addOnEligible: true },
  { slug: "ac-gas-filling", name: "Gas Filling", categories: ["ac-service"], skillTag: "ac_service", durationMin: 45, price: 1999, addOnEligible: true },
  { slug: "chimney-deep", name: "Deep Chimney Service", categories: ["chimney"], skillTag: "chimney", durationMin: 90, price: 899, addOnEligible: false },
  { slug: "chimney-basic", name: "Basic Chimney Service", categories: ["chimney"], skillTag: "chimney", durationMin: 45, price: 499, addOnEligible: false },
  { slug: "ro-repair-checkup", name: "RO Repair Check-up", categories: ["ro-service"], skillTag: "ro_service", durationMin: 45, price: 299, addOnEligible: true },
  { slug: "ro-filter-checkup", name: "Filter Check-up", categories: ["ro-service"], skillTag: "ro_service", durationMin: 30, price: 199, addOnEligible: true },
  { slug: "ro-filter-replacement", name: "Filter Replacement", categories: ["ro-service"], skillTag: "ro_service", durationMin: 45, price: 499, addOnEligible: true },
  { slug: "ro-install", name: "RO Installation", categories: ["ro-service"], skillTag: "ro_service", durationMin: 90, price: 599, addOnEligible: false },
  { slug: "ro-uninstall", name: "RO Uninstallation", categories: ["ro-service"], skillTag: "ro_service", durationMin: 60, price: 399, addOnEligible: false },
  ...["single", "double", "side-by-side", "triple"].flatMap((door) => [
    {
      slug: `fridge-clean-${door}`,
      name: `Fridge Cleaning (${door.replace(/-/g, " ")})`,
      categories: ["fridge"],
      skillTag: "fridge",
      durationMin: door === "triple" ? 90 : door === "side-by-side" ? 75 : 60,
      price: door === "single" ? 499 : door === "double" ? 599 : door === "side-by-side" ? 699 : 799,
      addOnEligible: false,
    },
    {
      slug: `fridge-checkup-${door}`,
      name: `Fridge Checkup (${door.replace(/-/g, " ")})`,
      categories: ["fridge"],
      skillTag: "fridge",
      durationMin: 45,
      price: 349,
      addOnEligible: true,
    },
  ]),
  ...["no-power", "no-cooling", "excess-cooling", "water-leakage", "door-issue", "noise-issue"].map((issue) => ({
    slug: `fridge-${issue}`,
    name: `Fridge ${issue.replace(/-/g, " ")}`,
    categories: ["fridge"],
    skillTag: "fridge",
    durationMin: 60,
    price: 449,
    addOnEligible: true,
  })),
];

const DEMO_EMAIL = "demo@gmail.com";
const DEMO_PASSWORD = "Demo@12345";

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
      inclusions: [
        "Verified professional",
        "Genuine parts & materials",
        "OTP-verified completion",
        "Upfront, transparent pricing",
      ],
      faqs: [],
      active: true,
      serviceKind: s.serviceKind || "standard",
    }))
  );

  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [77.18, 28.59],
        [77.25, 28.59],
        [77.25, 28.65],
        [77.18, 28.65],
        [77.18, 28.59],
      ],
    ],
  };
  const h3Cells = h3.polygonToCells(
    polygon.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng])),
    env.H3_RESOLUTION
  );
  await Zone.create({
    slug: "central-delhi",
    name: "Central Delhi",
    city: "Delhi",
    polygon,
    h3Cells,
    active: true,
  });

  const demoPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await User.create({
    phone: "+919999999999",
    name: "Play Store Demo",
    gender: "male",
    dateOfBirth: new Date("1990-01-01"),
    email: DEMO_EMAIL,
    passwordHash: demoPasswordHash,
    authMethod: "email",
    addresses: [
      {
        label: "Home",
        line1: "Demo Apartment, Connaught Place",
        line2: "Near Rajiv Chowk Metro",
        city: "New Delhi",
        pincode: "110001",
        lat: 28.6315,
        lng: 77.2167,
        isDefault: true,
      },
    ],
  });

  const center = { lat: 28.614, lng: 77.21 };
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
  console.log(`[seed] demo login — email: ${DEMO_EMAIL}  password: ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
