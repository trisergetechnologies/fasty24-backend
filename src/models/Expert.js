const mongoose = require("mongoose");
const { publicIdPlugin } = require("../lib/ids");

const expertSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    bio: { type: String, default: "" },
    skills: { type: [String], default: [], index: true },
    rating: { type: Number, default: 5.0 },
    completedJobs: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["offline", "online", "on_job"],
      default: "offline",
      index: true,
    },
    lastLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
    h3Index: { type: String, default: null, index: true },
    activeBooking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
    pushToken: { type: String, default: "" },
    trainingStatus: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
    kycStatus: {
      type: String,
      enum: ["pending", "submitted", "verified", "rejected"],
      default: "verified",
    },
    kycNote: { type: String, default: "" },
    kycSubmittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

expertSchema.plugin(publicIdPlugin);

module.exports = mongoose.model("Expert", expertSchema);
