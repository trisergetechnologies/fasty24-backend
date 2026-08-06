const mongoose = require("mongoose");
const { publicIdPlugin } = require("../lib/ids");

const kitItemSchema = new mongoose.Schema(
  {
    partId: { type: mongoose.Schema.Types.ObjectId, ref: "Part" },
    name: { type: String, default: "" },
    qty: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const partSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    sku: { type: String, default: "", trim: true },
    brand: { type: String, default: "" },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    // Category slugs, matching the Service.categories convention
    categories: { type: [String], default: [], index: true },
    serviceSlugs: { type: [String], default: [] },
    kind: {
      type: String,
      enum: ["part", "kit", "consumable", "labour"],
      default: "part",
      index: true,
    },
    kitItems: { type: [kitItemSchema], default: [] },
    unit: {
      type: String,
      enum: ["piece", "set", "litre", "metre", "kg", "hour"],
      default: "piece",
    },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: null },
    active: { type: Boolean, default: true, index: true },
    usageCount: { type: Number, default: 0 },
    source: {
      type: String,
      enum: ["catalog", "expert_custom"],
      default: "catalog",
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved",
      index: true,
    },
    createdByExpert: { type: mongoose.Schema.Types.ObjectId, ref: "Expert", default: null },
    createdFromBooking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

partSchema.plugin(publicIdPlugin);
partSchema.index({ name: "text", sku: "text", brand: "text" });

module.exports = mongoose.model("Part", partSchema);
