const mongoose = require("mongoose");

const slotCapacitySchema = new mongoose.Schema(
  {
    zoneSlug: { type: String, required: true, index: true },
    categorySlug: { type: String, required: true, index: true },
    slotId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    bookedCount: { type: Number, default: 0 },
    maxCapacity: { type: Number, default: 5 },
  },
  { timestamps: true }
);

slotCapacitySchema.index({ zoneSlug: 1, categorySlug: 1, slotId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("SlotCapacity", slotCapacitySchema);
