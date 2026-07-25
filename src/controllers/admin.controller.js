const asyncHandler = require("express-async-handler");
const Booking = require("../models/Booking");
const Expert = require("../models/Expert");
const { signToken } = require("../middleware/auth");
const env = require("../config/env");
const { serializeBooking, serializeExpert } = require("../lib/serialize");
const { findByPublicId } = require("../lib/ids");

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

const listExperts = asyncHandler(async (req, res) => {
  const filter = {};
  const kycStatus = req.query.kycStatus;
  if (kycStatus && ["pending", "submitted", "verified", "rejected"].includes(String(kycStatus))) {
    filter.kycStatus = String(kycStatus);
  }
  const experts = await Expert.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json(await Promise.all(experts.map((e) => serializeExpert(e))));
});

const getExpert = asyncHandler(async (req, res) => {
  const expert = await findByPublicId(Expert, req.params.id);
  if (!expert) return res.status(404).json({ error: "not_found" });

  const recentBookings = await Booking.find({
    expert: expert._id,
    "arrivalSelfie.url": { $ne: null },
  })
    .sort({ "timeline.arrivedAt": -1 })
    .limit(20)
    .select("publicId status arrivalSelfie timeline location items createdAt");

  const payload = await serializeExpert(expert);
  res.json({
    ...payload,
    arrivalSelfies: recentBookings.map((b) => {
      const o = b.toObject();
      return {
        bookingId: o.publicId,
        status: o.status,
        url: o.arrivalSelfie?.url || null,
        capturedAt: o.arrivalSelfie?.capturedAt || null,
        address: o.location?.address || "",
        serviceName: (o.items || []).map((i) => i.name).filter(Boolean).join(", ") || "Service",
      };
    }),
  });
});

const approveExpert = asyncHandler(async (req, res) => {
  const expert = await findByPublicId(Expert, req.params.id);
  if (!expert) return res.status(404).json({ error: "not_found" });
  expert.kycStatus = "verified";
  expert.kycNote = "";
  await expert.save();
  res.json(await serializeExpert(expert));
});

const rejectExpert = asyncHandler(async (req, res) => {
  const expert = await findByPublicId(Expert, req.params.id);
  if (!expert) return res.status(404).json({ error: "not_found" });
  const note = req.body?.note ? String(req.body.note).trim() : "";
  if (!note) {
    return res.status(400).json({ error: "note_required", message: "Rejection reason is required." });
  }
  expert.kycStatus = "rejected";
  expert.kycNote = note;
  await expert.save();
  res.json(await serializeExpert(expert));
});

const listReviews = asyncHandler(async (_req, res) => {
  res.json([]);
});

module.exports = {
  login,
  listBookings,
  listExperts,
  getExpert,
  approveExpert,
  rejectExpert,
  listReviews,
};
