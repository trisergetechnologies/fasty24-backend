require("dotenv").config();

const env = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  MONGO_URI: process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fasty24",
  JWT_SECRET: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || "dev_secret_change_me_in_production_32chars",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "30d",
  DEV_BYPASS_OTP: (process.env.DEV_BYPASS_OTP || "true") === "true",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin123",
  EXPO_PUSH_ENABLED: (process.env.EXPO_PUSH_ENABLED || "false") === "true",
  MSG91_API_KEY: process.env.MSG91_API_KEY || process.env.MSG91_AUTH_KEY || "",
  MSG91_SENDER: process.env.MSG91_SENDER || process.env.MSG91_SENDER_ID || "FASTY24",
  H3_RESOLUTION: parseInt(process.env.H3_RESOLUTION || "9", 10),
  DISPATCH_RADIUS_METERS: parseInt(process.env.DISPATCH_RADIUS_METERS || "7000", 10),
  // Demo mode: offer jobs to ANY online expert, ignoring distance + skill filters.
  DISPATCH_MATCH_ALL: (process.env.DISPATCH_MATCH_ALL || "false") === "true",
  DISPATCH_FAIL_AFTER_MS: parseInt(process.env.DISPATCH_FAIL_AFTER_MS || "300000", 10),
  DISPATCH_OFFER_TIMEOUT_SEC: parseInt(process.env.DISPATCH_OFFER_TIMEOUT_SEC || "120", 10),
  EXPERT_LOCATION_STALE_MS: parseInt(process.env.EXPERT_LOCATION_STALE_MS || "300000", 10),
  EXPERT_AVG_SPEED_KMPH: parseFloat(process.env.EXPERT_AVG_SPEED_KMPH || "22"),
  SLOT_WINDOWS: (process.env.SLOT_WINDOWS || "09-11,11-13,13-15,15-17,17-19").split(",").map((s) => s.trim()),
  SLOT_MAX_CAPACITY: parseInt(process.env.SLOT_MAX_CAPACITY || "5", 10),
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "",
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
  CLOUDINARY_FOLDER: process.env.CLOUDINARY_FOLDER || "fasty24/services",
  CORS_ORIGINS: (() => {
    const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0 || (parsed.length === 1 && parsed[0] === "*")) {
      return [
        "http://localhost:3001",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3000",
      ];
    }
    return parsed;
  })(),
};

module.exports = env;
