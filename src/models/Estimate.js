const mongoose = require("mongoose");
const { publicIdPlugin } = require("../lib/ids");

const proofImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const estimateLineSchema = new mongoose.Schema(
  {
    partId: { type: mongoose.Schema.Types.ObjectId, ref: "Part", default: null },
    isCustom: { type: Boolean, default: false },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    unit: { type: String, default: "piece" },
    kind: { type: String, enum: ["part", "labour"], default: "part" },
    imageUrl: { type: String, default: "" },
    qty: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    proofImages: { type: [proofImageSchema], default: [] },
    installedAt: { type: Date, default: null },
  },
  { _id: true }
);

/**
 * Lifecycle:
 *   draft -> sent -> approved | rejected | expired
 *   draft | sent -> cancelled (expert withdraws)
 * Payment settles after approval, before the booking can be completed.
 */
const estimateSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expert: { type: mongoose.Schema.Types.ObjectId, ref: "Expert", required: true, index: true },
    estimateNo: { type: String, default: "", index: true },
    status: {
      type: String,
      enum: ["draft", "sent", "approved", "rejected", "expired", "cancelled"],
      default: "draft",
      index: true,
    },
    diagnosisNotes: { type: String, default: "" },
    diagnosisImages: { type: [String], default: [] },
    lines: { type: [estimateLineSchema], default: [] },
    pricing: {
      subtotal: { type: Number, default: 0 },
      taxPercent: { type: Number, default: 18 },
      tax: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },
    sentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    rejectReason: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    payment: {
      status: {
        type: String,
        enum: ["unpaid", "pending", "paid", "failed", "refunded"],
        default: "unpaid",
        index: true,
      },
      method: { type: String, enum: ["razorpay", "cash", null], default: null },
      razorpayLinkId: { type: String, default: "" },
      razorpayShortUrl: { type: String, default: "" },
      razorpayOrderId: { type: String, default: "" },
      razorpayPaymentId: { type: String, default: "" },
      paidAt: { type: Date, default: null },
      cashCollectedAt: { type: Date, default: null },
    },
    expertEarning: { type: Number, default: 0 },
  },
  { timestamps: true }
);

estimateSchema.plugin(publicIdPlugin);

estimateSchema.methods.recomputePricing = function (taxPercent) {
  const pct = typeof taxPercent === "number" ? taxPercent : this.pricing.taxPercent || 0;
  let subtotal = 0;
  this.lines.forEach((line) => {
    const qty = Math.max(1, Number(line.qty) || 1);
    const unitPrice = Math.max(0, Number(line.unitPrice) || 0);
    line.qty = qty;
    line.unitPrice = unitPrice;
    line.lineTotal = Math.round(qty * unitPrice);
    subtotal += line.lineTotal;
  });
  const discount = Math.max(0, Number(this.pricing.discount) || 0);
  const tax = Math.round(Math.max(0, subtotal - discount) * (pct / 100));
  this.pricing.subtotal = subtotal;
  this.pricing.taxPercent = pct;
  this.pricing.discount = discount;
  this.pricing.tax = tax;
  this.pricing.total = Math.max(0, subtotal - discount + tax);
  return this.pricing;
};

estimateSchema.methods.isSettled = function () {
  return this.payment?.status === "paid" || !!this.payment?.cashCollectedAt;
};

module.exports = mongoose.model("Estimate", estimateSchema);
