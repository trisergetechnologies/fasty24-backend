require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");

/**
 * One-off migration: older schema stored `default: null` for sparse-unique
 * fields (phone, email, googleId). A sparse index only excludes documents
 * where the field is *missing*, not documents where it's explicitly `null`,
 * so multiple users with `googleId: null` caused E11000 duplicate key errors.
 * This unsets those null fields so the sparse indexes behave correctly.
 */
async function run() {
  await mongoose.connect(env.MONGO_URI);

  const results = await Promise.all([
    User.updateMany({ googleId: null }, { $unset: { googleId: 1 } }),
    User.updateMany({ email: null }, { $unset: { email: 1 } }),
    User.updateMany({ phone: null }, { $unset: { phone: 1 } }),
  ]);

  console.log(
    `[fix-user-nulls] unset googleId on ${results[0].modifiedCount}, email on ${results[1].modifiedCount}, phone on ${results[2].modifiedCount} documents`
  );

  await User.syncIndexes();
  console.log("[fix-user-nulls] indexes synced");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
