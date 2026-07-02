const mongoose = require("mongoose");

const zoneSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    city: { type: String, required: true },
    polygon: {
      type: {
        type: String,
        enum: ["Polygon"],
        default: "Polygon",
      },
      coordinates: [[[Number]]],
    },
    h3Cells: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Zone", zoneSchema);
