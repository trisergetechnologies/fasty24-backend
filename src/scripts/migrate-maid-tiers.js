require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Service = require("../models/Service");
const env = require("../config/env");
const { MAID_TIERS, MAID_CATEGORY_DESCRIPTION } = require("./maid-tiers");

/**
 * Replaces the old area-based Instant Maid catalog (maid-home-*, maid-kitchen-*,
 * maid-utensils-*, maid-bathroom-*) with four time-based tiers.
 * Only touches the services and categories collections — experts, users,
 * bookings and zones are left alone.
 * Run: node src/scripts/migrate-maid-tiers.js
 */

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log("[migrate-maid-tiers] connected");

  const keep = MAID_TIERS.map((s) => s.slug);
  const stale = await Service.find({ slug: { $regex: /^maid-/, $nin: keep } })
    .select("slug")
    .lean();
  if (stale.length > 0) {
    await Service.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    console.log(
      `[migrate-maid-tiers] removed ${stale.length} legacy services: ${stale
        .map((s) => s.slug)
        .join(", ")}`
    );
  } else {
    console.log("[migrate-maid-tiers] no legacy maid services found");
  }

  for (const svc of MAID_TIERS) {
    await Service.updateOne(
      { slug: svc.slug },
      {
        $set: { ...svc, active: true },
        $setOnInsert: { imageUrl: "", gallery: [], process: [], faqs: [] },
      },
      { upsert: true }
    );
    console.log(
      `[migrate-maid-tiers] upserted ${svc.slug} → ₹${svc.price} (${svc.durationMin} min)`
    );
  }

  const cat = await Category.updateOne(
    { slug: "instant-maid" },
    {
      $set: {
        description: MAID_CATEGORY_DESCRIPTION,
        supportsScheduling: false,
        supportsTimedJob: true,
      },
    }
  );
  if (cat.matchedCount === 0) {
    console.warn(
      "[migrate-maid-tiers] instant-maid category not found — run seed.js first"
    );
  }

  await mongoose.disconnect();
  console.log("[migrate-maid-tiers] done");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
