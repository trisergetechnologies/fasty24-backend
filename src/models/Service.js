const mongoose = require("mongoose");

const processStepSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const faqSchema = new mongoose.Schema(
  {
    q: { type: String, default: "" },
    a: { type: String, default: "" },
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    categories: { type: [String], default: [], index: true },
    skillTag: { type: String, required: true, index: true },
    shortDescription: { type: String, default: "" },
    description: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    gallery: { type: [String], default: [] },
    process: { type: [processStepSchema], default: [] },
    inclusions: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    faqs: { type: [faqSchema], default: [] },
    durationMin: { type: Number, required: true, min: 15 },
    price: { type: Number, required: true, min: 0 },
    serviceKind: {
      type: String,
      enum: ["timed", "standard", "addon_only"],
      default: "standard",
    },
    addOnEligible: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
