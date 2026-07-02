const mongoose = require("mongoose");
const { publicIdPlugin } = require("../lib/ids");

const lineItemSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    name: String,
    skillTag: String,
    durationMin: Number,
    price: Number,
    addedAt: { type: Date, default: Date.now },
    isAddOn: { type: Boolean, default: false },
  },
  { _id: true, timestamps: false }
);

const suggestionSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    serviceSlug: String,
    name: String,
    price: Number,
    message: { type: String, default: "" },
    suggestedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "accepted", "dismissed"], default: "pending" },
  },
  { _id: true }
);

/**
 * Lifecycle:
 *   created -> scheduled (slot booking after payment)
 *   created -> searching (instant after payment)
 *   scheduled -> searching (at slot window start)
 *   searching -> assigned -> in_progress -> completed
 *   cancelled (terminal)
 */
const bookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expert: { type: mongoose.Schema.Types.ObjectId, ref: "Expert", default: null, index: true },
    items: { type: [lineItemSchema], default: [] },
    location: {
      address: String,
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      h3Index: { type: String, index: true },
      zoneSlug: { type: String, default: "central-delhi" },
    },
    status: {
      type: String,
      enum: ["created", "scheduled", "searching", "assigned", "arrived", "in_progress", "completed", "cancelled"],
      default: "created",
      index: true,
    },
    bookingType: {
      type: String,
      enum: ["instant", "scheduled"],
      default: "instant",
    },
    scheduledFor: { type: Date, default: null, index: true },
    scheduledSlot: {
      slotId: String,
      date: String,
      windowStart: Date,
      windowEnd: Date,
    },
    jobTimer: {
      durationMin: Number,
      startedAt: Date,
      endsAt: Date,
      overtimeMin: { type: Number, default: 0 },
    },
    quotedEtaMin: { type: Number, default: null },
    pricing: {
      subtotal: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },
    payment: {
      status: {
        type: String,
        enum: ["unpaid", "authorized", "paid", "refunded", "failed"],
        default: "unpaid",
      },
      method: { type: String, default: "card_test" },
      providerRef: { type: String, default: "" },
    },
    timeline: {
      createdAt: { type: Date, default: Date.now },
      assignedAt: Date,
      arrivedAt: Date,
      startedAt: Date,
      completedAt: Date,
      cancelledAt: Date,
    },
    rating: {
      stars: { type: Number, default: null, min: 1, max: 5 },
      comment: { type: String, default: "" },
    },
    sessionOtp: {
      startCode: { type: String, default: null },
      endCode: { type: String, default: null },
      startVerifiedAt: Date,
      endVerifiedAt: Date,
    },
    pendingSuggestions: { type: [suggestionSchema], default: [] },
    expertEarning: { type: Number, default: 0 },
    declinedBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Expert" }],
      default: [],
    },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true }
);

bookingSchema.plugin(publicIdPlugin);

bookingSchema.methods.recomputePricing = function (discount = 0) {
  const base = this.items.reduce((sum, it) => sum + (it.price || 0), 0);
  const subtotal = Math.round(base);
  const tax = Math.round(subtotal * 0.05);
  this.pricing.subtotal = subtotal;
  this.pricing.discount = discount;
  this.pricing.tax = tax;
  this.pricing.total = Math.max(0, subtotal + tax - discount);
  return this.pricing;
};

module.exports = mongoose.model("Booking", bookingSchema);
