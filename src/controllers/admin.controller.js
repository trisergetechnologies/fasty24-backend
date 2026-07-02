const asyncHandler = require("express-async-handler");
const Booking = require("../models/Booking");
const Expert = require("../models/Expert");
const { signToken } = require("../middleware/auth");
const env = require("../config/env");
const { serializeBooking } = require("../lib/serialize");

const login = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (password !== env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = signToken({ sub: "admin", role: "admin" });
  res.json({ token, role: "admin" });
});

const listBookings = asyncHandler(async (_req, res) => {
  const bookings = await Booking.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("expert", "name phone publicId")
    .populate("customer", "name phone publicId");
  res.json(bookings.map(serializeBooking));
});

const listExperts = asyncHandler(async (_req, res) => {
  const experts = await Expert.find().sort({ createdAt: -1 }).limit(200);
  res.json(experts);
});

const listReviews = asyncHandler(async (_req, res) => {
  res.json([]);
});

module.exports = { login, listBookings, listExperts, listReviews };
