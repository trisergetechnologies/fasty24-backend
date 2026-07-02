const asyncHandler = require("express-async-handler");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Expert = require("../models/Expert");
const Category = require("../models/Category");
const geo = require("../services/geo");
const dispatcher = require("../services/dispatcher");
const scheduling = require("../services/scheduling");
const slotsService = require("../services/slots");
const pricing = require("../services/pricing");
const paymentService = require("../services/payment");
const notify = require("../services/notify");
const earningsService = require("../services/earnings");
const { findByPublicId, isMongoObjectId, bookingRoomId } = require("../lib/ids");
const { serializeBooking } = require("../lib/serialize");
const { serializeBookingForExpert } = require("../lib/serializeExpertBooking");
const { loadExpertFromAuth } = require("../lib/expertAuth");

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function loadBooking(paramId, extraFilter = {}) {
  return findByPublicId(Booking, paramId, extraFilter);
}

async function loadBookingPopulated(paramId, extraFilter = {}) {
  const filter = isMongoObjectId(paramId)
    ? { _id: paramId, ...extraFilter }
    : { publicId: paramId, ...extraFilter };
  return Booking.findOne(filter)
    .populate("expert", "name rating photoUrl phone lastLocation publicId")
    .populate("customer", "name phone publicId");
}

async function resolveServices(serviceIds) {
  const slugs = serviceIds.filter((id) => !isMongoObjectId(id));
  const mongoIds = serviceIds.filter(isMongoObjectId);
  const or = [];
  if (slugs.length) or.push({ slug: { $in: slugs } });
  if (mongoIds.length) or.push({ _id: { $in: mongoIds } });
  if (!or.length) return [];
  return Service.find({ active: true, $or: or });
}

const create = asyncHandler(async (req, res) => {
  const { serviceIds, location, bookingType, slotId, date } = req.body;
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    return res.status(400).json({ error: "serviceIds_required" });
  }
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    return res.status(400).json({ error: "location_required" });
  }

  const services = await resolveServices(serviceIds);
  if (!services.length) return res.status(400).json({ error: "no_valid_services" });

  const zone = await pricing.resolveZone(location.lat, location.lng);
  if (!zone) {
    return res.status(400).json({ error: "outside_service_area", message: "We don't serve this location yet." });
  }
  const zoneSlug = zone.slug;
  const primary = services[0];
  const categorySlug = primary.categories[0] || primary.skillTag;
  const isScheduled = bookingType === "scheduled";

  let scheduledSlot = null;
  if (isScheduled) {
    if (!slotId || !date) return res.status(400).json({ error: "slot_required" });
    const slots = await slotsService.getAvailableSlots({
      serviceId: primary.slug,
      date,
      lat: location.lat,
      lng: location.lng,
    });
    const slot = slots.slots.find((s) => s.slotId === slotId);
    if (!slot || !slot.available) return res.status(409).json({ error: "slot_unavailable" });
    const windowStart = slot.windowStart;
    const windowEnd = slot.windowEnd;
    scheduledSlot = { slotId, date, windowStart, windowEnd };
    await slotsService.reserveSlot({
      zoneSlug,
      categorySlug,
      slotId,
      date,
      windowStart,
      windowEnd,
    });
  }

  const items = services.map((s) => ({
    serviceId: s._id,
    name: s.name,
    skillTag: s.skillTag,
    durationMin: s.durationMin,
    price: s.price,
    isAddOn: false,
  }));

  const totalDuration = items.reduce((s, i) => s + (i.durationMin || 0), 0);
  const isTimed = primary.serviceKind === "timed";

  const booking = new Booking({
    customer: req.auth.sub,
    items,
    location: {
      address: location.address || "",
      lat: location.lat,
      lng: location.lng,
      h3Index: geo.toCell(location.lat, location.lng),
      zoneSlug,
    },
    status: "created",
    bookingType: isScheduled ? "scheduled" : "instant",
    scheduledSlot,
    scheduledFor: scheduledSlot?.windowStart || null,
    jobTimer: isTimed ? { durationMin: totalDuration } : undefined,
  });
  booking.recomputePricing();
  await booking.save();

  res.status(201).json(serializeBooking(booking));
});

async function expertFilter(req) {
  if (req.auth.role !== "expert") return {};
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) return { expert: null };
  return { expert: expert._id };
}

const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.auth.role === "customer") filter.customer = req.auth.sub;
  if (req.auth.role === "expert") {
    const ef = await expertFilter(req);
    if (!ef.expert) return res.json([]);
    filter.expert = ef.expert;
    if (req.query.scope === "today") filter.createdAt = { $gte: startOfDay() };
    if (req.query.scope === "history") filter.status = { $in: ["completed", "cancelled"] };
  }
  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("expert", "name rating photoUrl phone lastLocation publicId")
    .populate("customer", "name phone publicId");
  res.json(bookings.map(serializeBooking));
});

const get = asyncHandler(async (req, res) => {
  const extraFilter =
    req.auth.role === "expert"
      ? await expertFilter(req)
      : req.auth.role === "customer"
        ? { customer: req.auth.sub }
        : {};
  if (req.auth.role === "expert" && !extraFilter.expert) {
    return res.status(404).json({ error: "not_found" });
  }
  const booking = await loadBookingPopulated(req.params.id, extraFilter);
  if (!booking) return res.status(404).json({ error: "not_found" });
  let payload = serializeBooking(booking);
  if (req.auth.role === "expert") {
    payload = serializeBookingForExpert(booking, payload);
  }
  res.json(payload);
});

const cancel = asyncHandler(async (req, res) => {
  const booking = await loadBooking(req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (["completed", "cancelled"].includes(booking.status)) {
    return res.status(400).json({ error: "already_terminal" });
  }
  if (booking.scheduledSlot) {
    await slotsService.releaseSlot({
      zoneSlug: booking.location.zoneSlug,
      categorySlug: booking.items[0]?.skillTag,
      slotId: booking.scheduledSlot.slotId,
      date: booking.scheduledSlot.date,
    });
  }
  booking.status = "cancelled";
  booking.cancelReason = "user_cancelled";
  booking.timeline.cancelledAt = new Date();
  await booking.save();
  dispatcher.abortDispatch(booking._id);
  scheduling.cancelScheduledDispatch(booking._id);
  if (booking.expert) {
    await Expert.updateOne({ _id: booking.expert }, { status: "online", activeBooking: null });
  }
  notify.emitToRoom(req.app.get("io"), `booking:${bookingRoomId(booking)}`, "booking:status", {
    status: "cancelled",
  });
  res.json(serializeBooking(booking));
});

const addAddOn = asyncHandler(async (req, res) => {
  const booking = await loadBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (!["in_progress", "assigned"].includes(booking.status)) {
    return res.status(400).json({ error: "addons_only_during_active_booking" });
  }
  if (req.auth.role === "customer" && booking.customer.toString() !== req.auth.sub) {
    return res.status(403).json({ error: "forbidden" });
  }
  const sid = req.body.serviceId;
  const svc = isMongoObjectId(sid)
    ? await Service.findById(sid)
    : await Service.findOne({ slug: sid });
  if (!svc || !svc.active) return res.status(400).json({ error: "invalid_service" });
  if (!svc.addOnEligible) return res.status(400).json({ error: "service_not_add_on_eligible" });

  booking.items.push({
    serviceId: svc._id,
    name: svc.name,
    skillTag: svc.skillTag,
    durationMin: svc.durationMin,
    price: svc.price,
    isAddOn: true,
  });
  booking.recomputePricing(booking.pricing?.discount || 0);
  booking.pendingSuggestions = (booking.pendingSuggestions || []).map((s) =>
    s.serviceSlug === svc.slug && s.status === "pending" ? { ...s.toObject?.() || s, status: "accepted" } : s
  );
  await booking.save();
  notify.emitToRoom(req.app.get("io"), `booking:${bookingRoomId(booking)}`, "booking:addon", {
    item: booking.items[booking.items.length - 1],
    pricing: booking.pricing,
  });
  res.json(serializeBooking(booking));
});

const suggestAddOn = asyncHandler(async (req, res) => {
  const ef = await expertFilter(req);
  if (!ef.expert) return res.status(404).json({ error: "not_found" });
  const booking = await loadBooking(req.params.id, { expert: ef.expert });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (!["in_progress", "assigned"].includes(booking.status)) {
    return res.status(400).json({ error: "suggest_only_during_active_booking" });
  }
  const sid = req.body.serviceId;
  const svc = isMongoObjectId(sid)
    ? await Service.findById(sid)
    : await Service.findOne({ slug: sid });
  if (!svc || !svc.addOnEligible) return res.status(400).json({ error: "invalid_service" });
  booking.pendingSuggestions.push({
    serviceId: svc._id,
    serviceSlug: svc.slug,
    name: svc.name,
    price: svc.price,
    message: req.body.message || "",
    status: "pending",
  });
  await booking.save();
  notify.emitToRoom(req.app.get("io"), `customer:${booking.customer}`, "booking:addon_suggest", {
    bookingId: booking.publicId,
    suggestion: booking.pendingSuggestions[booking.pendingSuggestions.length - 1],
  });
  res.json(serializeBooking(booking));
});

const availableAddOns = asyncHandler(async (req, res) => {
  const booking = await loadBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: "not_found" });
  const skillTag = booking.items.find((i) => !i.isAddOn)?.skillTag;
  const addons = await Service.find({
    active: true,
    addOnEligible: true,
    $or: [{ skillTag }, { categories: { $in: [skillTag] } }],
  });
  res.json(addons.map((s) => ({
    id: s.slug,
    slug: s.slug,
    name: s.name,
    price: s.price,
    durationMin: s.durationMin,
  })));
});

const confirmPayment = asyncHandler(async (req, res) => {
  const booking = await loadBooking(req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  const result = await paymentService.capture(booking, req.body.providerRef);
  booking.payment.status = result.status;
  booking.payment.providerRef = result.providerRef;
  booking.payment.method = result.method;
  await booking.save();

  const io = req.app.get("io");
  if (booking.bookingType === "scheduled" && booking.scheduledSlot?.windowStart) {
    booking.status = "scheduled";
    await booking.save();
    scheduling.scheduleDispatch(io, booking._id, booking.scheduledSlot.windowStart);
  } else {
    setImmediate(() => dispatcher.runDispatch(io, booking._id));
  }
  res.json(serializeBooking(booking));
});

const rate = asyncHandler(async (req, res) => {
  const booking = await loadBooking(req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (booking.status !== "completed") return res.status(400).json({ error: "not_completed" });
  booking.rating = { stars: req.body.stars, comment: req.body.comment || "" };
  await booking.save();
  if (booking.expert) {
    const expert = await Expert.findById(booking.expert);
    if (expert) {
      const total = expert.rating * expert.completedJobs + req.body.stars;
      expert.rating = total / (expert.completedJobs + 1);
      await expert.save();
    }
  }
  res.json(serializeBooking(booking));
});

const expertArrived = asyncHandler(async (req, res) => {
  const ef = await expertFilter(req);
  if (!ef.expert) return res.status(404).json({ error: "not_found" });
  const booking = await loadBooking(req.params.id, { expert: ef.expert });
  if (!booking) return res.status(404).json({ error: "not_found" });
  booking.status = "arrived";
  booking.timeline.arrivedAt = new Date();
  await booking.save();
  const room = `booking:${bookingRoomId(booking)}`;
  const customerPayload = serializeBooking(booking);
  notify.emitToRoom(req.app.get("io"), room, "booking:update", {
    status: "arrived",
    timeline: booking.timeline,
    sessionOtp: customerPayload.sessionOtp,
  });
  notify.emitToRoom(req.app.get("io"), room, "booking:arrived", {
    status: "arrived",
    timeline: booking.timeline,
    sessionOtp: customerPayload.sessionOtp,
  });
  const payload = serializeBookingForExpert(booking, serializeBooking(booking));
  res.json(payload);
});

const expertStart = asyncHandler(async (req, res) => {
  const ef = await expertFilter(req);
  if (!ef.expert) return res.status(404).json({ error: "not_found" });
  const booking = await loadBooking(req.params.id, { expert: ef.expert });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (!["assigned", "arrived"].includes(booking.status)) return res.status(400).json({ error: "invalid_status" });
  const { otp } = req.body;
  if (!otp || booking.sessionOtp?.startCode !== String(otp).trim()) {
    return res.status(400).json({ error: "invalid_otp" });
  }
  booking.sessionOtp.startVerifiedAt = new Date();
  booking.status = "in_progress";
  booking.timeline.startedAt = new Date();
  if (booking.jobTimer?.durationMin) {
    const endsAt = new Date(Date.now() + booking.jobTimer.durationMin * 60 * 1000);
    booking.jobTimer.startedAt = new Date();
    booking.jobTimer.endsAt = endsAt;
  }
  await booking.save();
  const customerPayload = serializeBooking(booking);
  notify.emitToRoom(req.app.get("io"), `booking:${bookingRoomId(booking)}`, "booking:status", {
    status: "in_progress",
    jobTimer: booking.jobTimer,
    sessionOtp: customerPayload.sessionOtp,
  });
  notify.emitToRoom(req.app.get("io"), `booking:${bookingRoomId(booking)}`, "booking:update", {
    status: "in_progress",
    timeline: booking.timeline,
    jobTimer: booking.jobTimer,
    sessionOtp: customerPayload.sessionOtp,
  });
  const payload = serializeBookingForExpert(booking, serializeBooking(booking));
  res.json(payload);
});

const expertComplete = asyncHandler(async (req, res) => {
  const ef = await expertFilter(req);
  if (!ef.expert) return res.status(404).json({ error: "not_found" });
  const booking = await loadBooking(req.params.id, { expert: ef.expert });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (booking.status !== "in_progress") return res.status(400).json({ error: "invalid_status" });
  const { otp } = req.body;
  if (!otp || booking.sessionOtp?.endCode !== String(otp).trim()) {
    return res.status(400).json({ error: "invalid_otp" });
  }
  if (booking.jobTimer?.endsAt && new Date() > booking.jobTimer.endsAt) {
    booking.jobTimer.overtimeMin = Math.ceil(
      (Date.now() - booking.jobTimer.endsAt.getTime()) / 60000
    );
  }
  booking.sessionOtp.endVerifiedAt = new Date();
  booking.status = "completed";
  booking.timeline.completedAt = new Date();
  booking.expertEarning = Math.round((booking.pricing?.subtotal || 0) * earningsService.COMMISSION_RATE);
  await booking.save();
  await Expert.updateOne(
    { _id: ef.expert },
    { status: "online", activeBooking: null, $inc: { completedJobs: 1 } }
  );
  notify.emitToRoom(req.app.get("io"), `booking:${bookingRoomId(booking)}`, "booking:status", {
    status: "completed",
  });
  const payload = serializeBookingForExpert(booking, serializeBooking(booking));
  res.json(payload);
});

module.exports = {
  create,
  list,
  get,
  cancel,
  addAddOn,
  suggestAddOn,
  availableAddOns,
  confirmPayment,
  rate,
  expertArrived,
  expertStart,
  expertComplete,
};
