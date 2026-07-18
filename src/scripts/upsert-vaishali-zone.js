/**
 * Upsert the Vaishali (~7 km) service zone without wiping other data.
 * Usage: node src/scripts/upsert-vaishali-zone.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Zone = require("../models/Zone");
const env = require("../config/env");
const geo = require("../services/geo");

async function main() {
  await mongoose.connect(env.MONGO_URI);

  const center = {
    lat: env.SERVICE_AREA_LAT,
    lng: env.SERVICE_AREA_LNG,
  };
  const delta = env.SERVICE_AREA_RADIUS_KM / 111;
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [center.lng - delta, center.lat - delta],
        [center.lng + delta, center.lat - delta],
        [center.lng + delta, center.lat + delta],
        [center.lng - delta, center.lat + delta],
        [center.lng - delta, center.lat - delta],
      ],
    ],
  };
  const k = geo.kForRadiusMeters(env.SERVICE_AREA_RADIUS_KM * 1000);
  const h3Cells = geo.ringCells(center.lat, center.lng, k);

  // Deactivate outdated Central Delhi seed zone if present
  await Zone.updateMany(
    { slug: { $ne: env.SERVICE_AREA_SLUG } },
    { $set: { active: false } }
  );

  const zone = await Zone.findOneAndUpdate(
    { slug: env.SERVICE_AREA_SLUG },
    {
      slug: env.SERVICE_AREA_SLUG,
      name: env.SERVICE_AREA_NAME,
      city: env.SERVICE_AREA_CITY,
      polygon,
      h3Cells,
      active: true,
    },
    { upsert: true, new: true }
  );

  console.log(
    `[upsert-zone] ${zone.slug} active cells=${h3Cells.length} center=${center.lat},${center.lng} radiusKm=${env.SERVICE_AREA_RADIUS_KM}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
