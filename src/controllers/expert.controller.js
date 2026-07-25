const asyncHandler = require("express-async-handler");
const Expert = require("../models/Expert");
const Booking = require("../models/Booking");
const geo = require("../services/geo");
const earningsService = require("../services/earnings");
const { serializeExpert, serializeBooking } = require("../lib/serialize");
const { loadExpertFromAuth } = require("../lib/expertAuth");
const dispatcher = require("../services/dispatcher");

async function requireExpert(req, res) {
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return expert;
}

const me = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  res.json(await serializeExpert(expert));
});

const updateProfile = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const allowed = ["name", "email", "photoUrl", "bio", "skills"];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  const updated = await Expert.findByIdAndUpdate(expert._id, patch, { new: true });
  res.json(await serializeExpert(updated));
});

const goOnline = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  // Missing kycStatus is treated as verified so pre-feature production experts stay online.
  if (expert.kycStatus && expert.kycStatus !== "verified") {
    return res.status(403).json({
      error: "kyc_not_verified",
      message: "Complete onboarding and wait for admin approval before going online.",
    });
  }
  const { lat, lng } = req.body;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat_lng_required" });
  }
  const updated = await Expert.findByIdAndUpdate(
    expert._id,
    {
      lastLocation: { lat, lng, updatedAt: new Date() },
      h3Index: geo.toCell(lat, lng),
      status: expert.status === "offline" ? "online" : expert.status,
    },
    { new: true }
  );
  res.json(await serializeExpert(updated));
});

const goOffline = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const updated = await Expert.findByIdAndUpdate(expert._id, { status: "offline" }, { new: true });
  res.json(await serializeExpert(updated));
});

const dashboard = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const data = await earningsService.getDashboard(expert._id.toString());
  const recent = await Booking.find({ expert: expert._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("customer", "name phone publicId");
  res.json({ ...data, recentOrders: recent.map(serializeBooking) });
});

const earnings = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const data = await earningsService.getEarnings(expert._id.toString(), req.query.period || "today");
  res.json(data);
});

const pendingOffer = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const offers = dispatcher.getPendingOffers(expert._id.toString());
  res.json(offers.length <= 1 ? offers[0] || null : offers);
});

const respondOffer = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const { bookingId, accepted } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId_required" });
  const io = req.app.get("io");
  const ok = await dispatcher.handleExpertResponse(io, bookingId, expert._id.toString(), !!accepted);
  res.json({ ok });
});

const submitOnboarding = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;

  const { specialization, documents = {}, bank = {} } = req.body;
  const requiredDocs = [
    "aadhaarNumber",
    "aadhaarFrontUrl",
    "aadhaarBackUrl",
    "panNumber",
    "panUrl",
    "selfieUrl",
  ];
  for (const key of requiredDocs) {
    if (!documents[key] || !String(documents[key]).trim()) {
      return res.status(400).json({ error: "documents_incomplete", message: `Missing ${key}` });
    }
  }
  if (!bank.accountNumber || !bank.ifsc || !bank.holderName) {
    return res.status(400).json({
      error: "bank_incomplete",
      message: "Account number, IFSC, and holder name are required.",
    });
  }

  const updated = await Expert.findByIdAndUpdate(
    expert._id,
    {
      specialization: specialization || "general",
      documents: {
        aadhaarNumber: String(documents.aadhaarNumber).trim(),
        aadhaarFrontUrl: String(documents.aadhaarFrontUrl).trim(),
        aadhaarBackUrl: String(documents.aadhaarBackUrl).trim(),
        panNumber: String(documents.panNumber).trim().toUpperCase(),
        panUrl: String(documents.panUrl).trim(),
        selfieUrl: String(documents.selfieUrl).trim(),
      },
      bank: {
        accountNumber: String(bank.accountNumber).trim(),
        ifsc: String(bank.ifsc).trim().toUpperCase(),
        holderName: String(bank.holderName).trim(),
      },
      photoUrl: String(documents.selfieUrl).trim(),
      kycStatus: "submitted",
      kycNote: "",
      kycSubmittedAt: new Date(),
    },
    { new: true }
  );
  res.json(await serializeExpert(updated));
});

const updateTraining = asyncHandler(async (req, res) => {
  const expert = await requireExpert(req, res);
  if (!expert) return;
  const allowed = ["pending", "in_progress", "completed"];
  if (!allowed.includes(req.body.status)) {
    return res.status(400).json({ error: "invalid_training_status" });
  }
  const updated = await Expert.findByIdAndUpdate(
    expert._id,
    { trainingStatus: req.body.status },
    { new: true }
  );
  res.json(await serializeExpert(updated));
});

module.exports = {
  me,
  updateProfile,
  goOnline,
  goOffline,
  dashboard,
  earnings,
  pendingOffer,
  respondOffer,
  submitOnboarding,
  updateTraining,
};
