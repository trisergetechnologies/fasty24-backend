/**
 * Smoke tests — run with: npm test
 * Requires MongoDB and seeded data.
 */
require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");
const env = require("../src/config/env");
const geo = require("../src/services/geo");
const slots = require("../src/services/slots");

async function testGeo() {
  const km = geo.haversineKm({ lat: 28.614, lng: 77.21 }, { lat: 28.62, lng: 77.22 });
  assert(km < 2, "haversine should be under 2km for nearby points");
  const k = geo.kForRadiusMeters(7000);
  assert(k >= 1, "k ring should be at least 1");
  console.log("[ok] geo");
}

async function testSlots() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);
  const result = await slots.getAvailableSlots({
    serviceId: "ac-jet-service",
    date,
    lat: 28.614,
    lng: 77.21,
  });
  assert(Array.isArray(result.slots), "slots array expected");
  console.log("[ok] slots", result.slots.length, "windows");
}

async function main() {
  await mongoose.connect(env.MONGO_URI);
  await testGeo();
  await testSlots();
  await mongoose.disconnect();
  console.log("[smoke] all passed");
}

main().catch((err) => {
  console.error("[smoke] failed", err);
  process.exit(1);
});
