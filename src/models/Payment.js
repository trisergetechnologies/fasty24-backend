const mongoose = require("mongoose");
const { publicIdPlugin } = require("../lib/ids");

/**
 * One row per collection attempt across both payment surfaces
 * (upfront booking fee and post-work estimate settlement) so the
 * Razorpay webhook has a single place to reconcile against.
 */
const paymentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["booking", "estimate"], required: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    estimate: { type: mongoose.Schema.Types.ObjectId, ref: "Estimate", default: null, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    method: { type: String, enum: ["razorpay", "cash", "test"], default: "razorpay" },
    status: {
      type: String,
      enum: ["created", "pending", "paid", "failed", "refunded"],
      default: "created",
      index: true,
    },
    razorpay: {
      orderId: { type: String, default: null },
      paymentId: { type: String, default: null },
      signature: { type: String, default: null },
      linkId: { type: String, default: null },
      shortUrl: { type: String, default: null },
    },
    cash: {
      collectedByExpert: { type: mongoose.Schema.Types.ObjectId, ref: "Expert", default: null },
      collectedAt: { type: Date, default: null },
    },
    webhookEventIds: { type: [String], default: [] },
    failureReason: { type: String, default: "" },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.plugin(publicIdPlugin);
// Partial (not sparse) indexes: a sparse index still stores explicit nulls, so
// two cash rows would collide on razorpay.orderId === null.
paymentSchema.index(
  { "razorpay.orderId": 1 },
  { unique: true, partialFilterExpression: { "razorpay.orderId": { $type: "string" } } }
);
paymentSchema.index(
  { "razorpay.linkId": 1 },
  { unique: true, partialFilterExpression: { "razorpay.linkId": { $type: "string" } } }
);

module.exports = mongoose.model("Payment", paymentSchema);
