const asyncHandler = require("express-async-handler");
const Booking = require("../models/Booking");
const Estimate = require("../models/Estimate");
const Part = require("../models/Part");
const Service = require("../models/Service");
const env = require("../config/env");
const estimatesService = require("../services/estimates");
const { findByPublicId, isMongoObjectId } = require("../lib/ids");
const { loadExpertFromAuth } = require("../lib/expertAuth");
const { serializeEstimate } = require("../lib/serializeCommerce");
const { uniqueSlug } = require("./part.controller");

const EDITABLE_STATUSES = ["draft", "sent"];

/** Category slugs of the booking's primary service, used to file custom parts. */
async function bookingCategorySlugs(booking) {
  const primary = (booking.items || []).find((it) => !it.isAddOn) || booking.items?.[0];
  if (!primary?.serviceId) return [];
  const service = await Service.findById(primary.serviceId).select("categories").lean();
  return service?.categories || [];
}

async function nextEstimateNo() {
  const year = new Date().getFullYear();
  const count = await Estimate.countDocuments({
    createdAt: { $gte: new Date(`${year}-01-01T00:00:00.000Z`) },
  });
  return `EST-${year}-${String(count + 1).padStart(6, "0")}`;
}

async function loadEstimate(paramId) {
  return findByPublicId(Estimate, paramId);
}

async function loadEstimateForExpert(req, paramId) {
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) return { error: "not_found" };
  const estimate = await loadEstimate(paramId);
  if (!estimate || estimate.expert.toString() !== expert._id.toString()) {
    return { error: "not_found" };
  }
  return { estimate, expert };
}

async function loadEstimateForCustomer(req, paramId) {
  const estimate = await loadEstimate(paramId);
  if (!estimate || estimate.customer.toString() !== String(req.auth.sub)) {
    return { error: "not_found" };
  }
  return { estimate };
}

/**
 * Normalises incoming lines. Catalog lines are re-priced from the Part record so
 * an expert cannot silently change a verified price; custom lines keep the
 * expert's price and spawn a pending Part for admin review.
 */
async function buildLines(rawLines, { expert, booking, categorySlugs = [] }) {
  const lines = [];
  const refs = rawLines.map((l) => l.partId).filter(Boolean).map(String);
  const or = [{ publicId: { $in: refs } }];
  const mongoIds = refs.filter(isMongoObjectId);
  if (mongoIds.length) or.push({ _id: { $in: mongoIds } });
  const parts = refs.length ? await Part.find({ $or: or }) : [];
  const partByKey = new Map();
  parts.forEach((p) => {
    partByKey.set(p.publicId, p);
    partByKey.set(p._id.toString(), p);
  });

  for (const raw of rawLines) {
    const qty = Math.max(1, Number(raw.qty) || 1);
    const kind = raw.kind === "labour" ? "labour" : "part";
    const part = raw.partId ? partByKey.get(String(raw.partId)) : null;

    if (part) {
      lines.push({
        partId: part._id,
        isCustom: false,
        name: part.name,
        sku: part.sku,
        unit: part.unit,
        kind: part.kind === "labour" ? "labour" : "part",
        imageUrl: part.imageUrl,
        qty,
        unitPrice: part.price,
        lineTotal: Math.round(qty * part.price),
        proofImages: raw.proofImages || [],
      });
      continue;
    }

    const name = String(raw.name || "").trim();
    if (!name) continue;
    const unitPrice = Math.max(0, Number(raw.unitPrice) || 0);

    // Queue the expert's custom part for admin verification without blocking the job
    let pendingPartId = null;
    if (kind === "part") {
      const slug = await uniqueSlug(`${name}-custom`);
      const created = await Part.create({
        name,
        slug,
        sku: raw.sku || "",
        brand: raw.brand || "",
        imageUrl: raw.imageUrl || "",
        categories: raw.categories || categorySlugs,
        kind: "part",
        unit: raw.unit || "piece",
        price: unitPrice,
        source: "expert_custom",
        verificationStatus: "pending",
        createdByExpert: expert._id,
        createdFromBooking: booking._id,
      });
      pendingPartId = created._id;
    }

    lines.push({
      partId: pendingPartId,
      isCustom: true,
      name,
      sku: raw.sku || "",
      unit: raw.unit || "piece",
      kind,
      imageUrl: raw.imageUrl || "",
      qty,
      unitPrice,
      lineTotal: Math.round(qty * unitPrice),
      proofImages: raw.proofImages || [],
    });
  }

  return lines;
}

const create = asyncHandler(async (req, res) => {
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) return res.status(404).json({ error: "not_found" });
  const booking = await findByPublicId(Booking, req.params.id, { expert: expert._id });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (!["arrived", "in_progress"].includes(booking.status)) {
    return res.status(400).json({
      error: "invalid_status",
      message: "Create an estimate after you have arrived at the location.",
    });
  }

  const rawLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!rawLines.length) return res.status(400).json({ error: "lines_required" });

  const categorySlugs = await bookingCategorySlugs(booking);
  const lines = await buildLines(rawLines, { expert, booking, categorySlugs });
  if (!lines.length) return res.status(400).json({ error: "lines_required" });

  const estimate = new Estimate({
    booking: booking._id,
    customer: booking.customer,
    expert: expert._id,
    estimateNo: await nextEstimateNo(),
    status: "draft",
    diagnosisNotes: req.body.diagnosisNotes || "",
    diagnosisImages: req.body.diagnosisImages || [],
    lines,
  });
  estimate.pricing.discount = Math.max(0, Number(req.body.discount) || 0);
  estimate.recomputePricing(env.ESTIMATE_TAX_PERCENT);
  estimate.expertEarning = estimatesService.computeEstimateEarning(estimate);
  await estimate.save();

  res.status(201).json(serializeEstimate(estimate));
});

const update = asyncHandler(async (req, res) => {
  const { estimate, expert, error } = await loadEstimateForExpert(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (estimate.status !== "draft") {
    return res.status(400).json({ error: "not_editable", message: "Only draft estimates can be edited." });
  }
  const booking = await Booking.findById(estimate.booking);
  if (!booking) return res.status(404).json({ error: "not_found" });

  if (Array.isArray(req.body.lines)) {
    const categorySlugs = await bookingCategorySlugs(booking);
    const lines = await buildLines(req.body.lines, { expert, booking, categorySlugs });
    if (!lines.length) return res.status(400).json({ error: "lines_required" });
    estimate.lines = lines;
  }
  if (req.body.diagnosisNotes !== undefined) estimate.diagnosisNotes = req.body.diagnosisNotes;
  if (req.body.diagnosisImages !== undefined) estimate.diagnosisImages = req.body.diagnosisImages;
  if (req.body.discount !== undefined) {
    estimate.pricing.discount = Math.max(0, Number(req.body.discount) || 0);
  }
  estimate.recomputePricing(env.ESTIMATE_TAX_PERCENT);
  estimate.expertEarning = estimatesService.computeEstimateEarning(estimate);
  await estimate.save();

  res.json(serializeEstimate(estimate));
});

const send = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForExpert(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (estimate.status !== "draft") {
    return res.status(400).json({ error: "invalid_status", message: "This estimate was already sent." });
  }
  const booking = await Booking.findById(estimate.booking);
  if (!booking) return res.status(404).json({ error: "not_found" });

  estimate.status = "sent";
  estimate.sentAt = new Date();
  estimate.expiresAt = new Date(Date.now() + env.ESTIMATE_VALID_HOURS * 3600 * 1000);
  await estimate.save();

  await estimatesService.emitEstimateEvent(req.app.get("io"), {
    estimate,
    booking,
    event: "estimate:new",
  });
  await estimatesService.pushToCustomer(
    estimate,
    "Repair estimate ready",
    `Your expert has sent an estimate of ₹${estimate.pricing.total}. Review and approve to proceed.`,
    { bookingId: booking.publicId, estimateId: estimate.publicId, kind: "estimate_new" }
  );

  res.json(serializeEstimate(estimate));
});

const approve = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForCustomer(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (estimate.status !== "sent") {
    return res.status(400).json({ error: "invalid_status", message: "This estimate is no longer pending." });
  }
  if (estimate.expiresAt && estimate.expiresAt < new Date()) {
    estimate.status = "expired";
    await estimate.save();
    return res.status(400).json({ error: "expired", message: "This estimate has expired." });
  }
  const booking = await Booking.findById(estimate.booking);
  if (!booking) return res.status(404).json({ error: "not_found" });

  estimate.status = "approved";
  estimate.respondedAt = new Date();
  await estimate.save();

  await estimatesService.emitEstimateEvent(req.app.get("io"), {
    estimate,
    booking,
    event: "estimate:approved",
  });
  await estimatesService.pushToExpert(
    estimate,
    "Estimate approved",
    `Customer approved ₹${estimate.pricing.total}. You can start the replacement.`,
    { bookingId: booking.publicId, estimateId: estimate.publicId, kind: "estimate_approved" }
  );

  res.json(serializeEstimate(estimate));
});

const reject = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForCustomer(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (estimate.status !== "sent") {
    return res.status(400).json({ error: "invalid_status" });
  }
  const booking = await Booking.findById(estimate.booking);
  if (!booking) return res.status(404).json({ error: "not_found" });

  estimate.status = "rejected";
  estimate.respondedAt = new Date();
  estimate.rejectReason = String(req.body?.reason || "").slice(0, 500);
  await estimate.save();

  await estimatesService.emitEstimateEvent(req.app.get("io"), {
    estimate,
    booking,
    event: "estimate:rejected",
  });
  await estimatesService.pushToExpert(
    estimate,
    "Estimate declined",
    estimate.rejectReason || "The customer declined the estimate.",
    { bookingId: booking.publicId, estimateId: estimate.publicId, kind: "estimate_rejected" }
  );

  res.json(serializeEstimate(estimate));
});

const cancel = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForExpert(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (!EDITABLE_STATUSES.includes(estimate.status)) {
    return res.status(400).json({ error: "invalid_status", message: "Only draft or sent estimates can be withdrawn." });
  }
  const booking = await Booking.findById(estimate.booking);
  estimate.status = "cancelled";
  await estimate.save();
  if (booking) {
    await estimatesService.emitEstimateEvent(req.app.get("io"), {
      estimate,
      booking,
      event: "estimate:cancelled",
    });
  }
  res.json(serializeEstimate(estimate));
});

/** Expert attaches proof photos of the part actually installed. */
const addLineProof = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForExpert(req, req.params.id);
  if (error) return res.status(404).json({ error });
  if (estimate.status !== "approved") {
    return res.status(400).json({ error: "invalid_status", message: "Add proof photos after the estimate is approved." });
  }
  const line = estimate.lines.id(req.params.lineId);
  if (!line) return res.status(404).json({ error: "line_not_found" });

  const urls = []
    .concat(req.body?.urls || [])
    .concat(req.body?.url ? [req.body.url] : [])
    .map((u) => String(u).trim())
    .filter(Boolean);
  if (!urls.length) return res.status(400).json({ error: "url_required" });

  urls.forEach((url) => line.proofImages.push({ url, uploadedAt: new Date() }));
  line.installedAt = line.installedAt || new Date();
  await estimate.save();

  const booking = await Booking.findById(estimate.booking);
  if (booking) {
    await estimatesService.emitEstimateEvent(req.app.get("io"), {
      estimate,
      booking,
      event: "estimate:updated",
    });
  }

  res.json(serializeEstimate(estimate));
});

const removeLineProof = asyncHandler(async (req, res) => {
  const { estimate, error } = await loadEstimateForExpert(req, req.params.id);
  if (error) return res.status(404).json({ error });
  const line = estimate.lines.id(req.params.lineId);
  if (!line) return res.status(404).json({ error: "line_not_found" });
  const url = String(req.body?.url || "").trim();
  line.proofImages = line.proofImages.filter((p) => p.url !== url);
  await estimate.save();
  res.json(serializeEstimate(estimate));
});

const listForBooking = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.auth.role === "expert") {
    const expert = await loadExpertFromAuth(req.auth);
    if (!expert) return res.status(404).json({ error: "not_found" });
    filter.expert = expert._id;
  } else if (req.auth.role === "customer") {
    filter.customer = req.auth.sub;
  }
  const booking = await findByPublicId(Booking, req.params.id);
  if (!booking) return res.status(404).json({ error: "not_found" });

  const estimates = await Estimate.find({ booking: booking._id, ...filter }).sort({ createdAt: -1 });
  res.json(estimates.map((e) => serializeEstimate(e)));
});

const get = asyncHandler(async (req, res) => {
  const estimate = await loadEstimate(req.params.id);
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (req.auth.role === "customer" && estimate.customer.toString() !== String(req.auth.sub)) {
    return res.status(404).json({ error: "not_found" });
  }
  if (req.auth.role === "expert") {
    const expert = await loadExpertFromAuth(req.auth);
    if (!expert || estimate.expert.toString() !== expert._id.toString()) {
      return res.status(404).json({ error: "not_found" });
    }
  }
  const booking = await Booking.findById(estimate.booking).select("publicId").lean();
  const payload = serializeEstimate(estimate);
  payload.bookingId = booking?.publicId || payload.bookingId;
  res.json(payload);
});

const adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter["payment.status"] = req.query.paymentStatus;
  const estimates = await Estimate.find(filter)
    .populate("booking", "publicId")
    .populate("expert", "name")
    .populate("customer", "name phone")
    .sort({ createdAt: -1 })
    .limit(300);
  res.json(estimates.map((e) => serializeEstimate(e, { includePaymentRefs: true })));
});

module.exports = {
  create,
  update,
  send,
  approve,
  reject,
  cancel,
  addLineProof,
  removeLineProof,
  listForBooking,
  get,
  adminList,
};
