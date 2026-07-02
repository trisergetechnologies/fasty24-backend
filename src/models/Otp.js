const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    code: { type: String, required: true },
    role: { type: String, enum: ["customer", "expert"], required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    consumed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Otp", otpSchema);
