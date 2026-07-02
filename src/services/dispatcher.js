const Expert = require("../models/Expert");
const Booking = require("../models/Booking");
const env = require("../config/env");
const geo = require("./geo");
const notify = require("./notify");
const { genSessionOtp } = require("../lib/otp");
const earningsService = require("../services/earnings");
const { isMongoObjectId, bookingRoomId } = require("../lib/ids");

/** bookingId -> { expertIds: Set, expiresAt, timer } */
const activeBroadcasts = new Map();
/** expertId -> [{ payload, expiresAt, bookingInternalId }] */
const pendingOffersForExpert = new Map();
const dispatchAborters = new Map();
const failTimers = new Map();

function getRequiredSkills(booking) {
  const tags = new Set();
  for (const item of booking.items) {
    if (item.skillTag) tags.add(item.skillTag);
  }
  return Array.from(tags);
}

function skillScoreForExpert(expert, requiredSkills) {
  if (!requiredSkills.length) return 1;
  const skills = expert.skills || [];
  let matched = 0;
  for (const tag of requiredSkills) {
    if (skills.includes(tag)) matched += 1;
  }
  return matched / requiredSkills.length;
}

function isLocationFresh(expert) {
  const updatedAt = expert.lastLocation?.updatedAt;
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() <= env.EXPERT_LOCATION_STALE_MS;
}

async function findBroadcastCandidates(booking, requiredSkills) {
  const { lat, lng } = booking.location;
  const declined = (booking.declinedBy || []).map((id) => id.toString());
  const staleBefore = new Date(Date.now() - env.EXPERT_LOCATION_STALE_MS);

  const baseQuery = {
    status: "online",
    "lastLocation.lat": { $ne: null },
    "lastLocation.lng": { $ne: null },
    "lastLocation.updatedAt": { $gte: staleBefore },
    activeBooking: null,
  };

  // In demo match-all mode we skip the H3 cell pre-filter so distance never matters.
  let experts;
  if (env.DISPATCH_MATCH_ALL) {
    experts = await Expert.find(baseQuery).lean();
  } else {
    const k = geo.kForRadiusMeters(env.DISPATCH_RADIUS_METERS);
    const cells = geo.ringCells(lat, lng, k);
    experts = await Expert.find({ ...baseQuery, h3Index: { $in: cells } }).lean();
  }

  return experts
    .filter((e) => !declined.includes(e._id.toString()))
    .map((e) => {
      const distanceKm = geo.haversineKm(
        { lat: e.lastLocation.lat, lng: e.lastLocation.lng },
        { lat, lng }
      );
      const distanceM = distanceKm * 1000;
      const skillScore = skillScoreForExpert(e, requiredSkills);
      return { expert: e, distanceKm, distanceM, skillScore };
    })
    .filter((c) => {
      if (!isLocationFresh(c.expert)) return false;
      // Demo mode: offer to every online expert regardless of distance/skill.
      if (env.DISPATCH_MATCH_ALL) return true;
      return c.distanceM <= env.DISPATCH_RADIUS_METERS && c.skillScore > 0;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm || b.skillScore - a.skillScore);
}

function buildOfferPayload(booking, candidate) {
  const publicBookingId = bookingRoomId(booking);
  const subtotal = booking.pricing?.subtotal || 0;
  const total = booking.pricing?.total || 0;
  return {
    bookingId: publicBookingId,
    serviceName: (booking.items || []).map((i) => i.name).join(", ") || "Service",
    durationMin: (booking.items || []).reduce((s, i) => s + (i.durationMin || 0), 0),
    etaMin: Math.round(geo.etaMinutes(candidate.distanceKm) * 10) / 10,
    eta: Math.round(geo.etaMinutes(candidate.distanceKm)),
    distanceKm: Math.round(candidate.distanceKm * 100) / 100,
    customerDistance: Math.round(candidate.distanceKm * 100) / 100,
    pickupLocation: booking.location,
    address: booking.location?.address || "",
    scheduledSlot: booking.scheduledSlot || null,
    scheduledAt: booking.scheduledFor || booking.scheduledSlot?.windowStart || null,
    bookingType: booking.bookingType || "instant",
    items: (booking.items || []).map((i) => ({
      name: i.name,
      durationMin: i.durationMin,
      price: i.price,
    })),
    total,
    totalAmount: total,
    expertEarning: Math.round(subtotal * earningsService.COMMISSION_RATE),
    offerExpiresInSec: env.DISPATCH_OFFER_TIMEOUT_SEC,
  };
}

function broadcastOffers(io, booking, candidates) {
  const internalKey = booking._id.toString();
  const expiresAt = Date.now() + env.DISPATCH_OFFER_TIMEOUT_SEC * 1000;
  const expertIds = new Set();

  for (const cand of candidates) {
    const expertId = cand.expert._id.toString();
    expertIds.add(expertId);
    const payload = buildOfferPayload(booking, cand);
    const entry = { payload, expiresAt, bookingInternalId: internalKey };
    const list = pendingOffersForExpert.get(expertId) || [];
    list.push(entry);
    pendingOffersForExpert.set(expertId, list);
    notify.emitToRoom(io, `expert:${expertId}`, "dispatch:offer", payload);
    notify.expoPush(
      cand.expert.pushToken,
      "New Fasty-24 job nearby",
      `${payload.serviceName} · ₹${payload.total}`,
      { bookingId: payload.bookingId, kind: "dispatch_offer" }
    );
  }

  const timer = setTimeout(() => {
    cleanupBroadcast(internalKey);
    failDispatchIfStillSearching(io, internalKey);
  }, env.DISPATCH_FAIL_AFTER_MS);

  failTimers.set(internalKey, timer);
  activeBroadcasts.set(internalKey, { expertIds, expiresAt, timer: null });
}

function cleanupBroadcast(internalKey) {
  const broadcast = activeBroadcasts.get(internalKey);
  if (!broadcast) return;
  for (const expertId of broadcast.expertIds) {
    const list = (pendingOffersForExpert.get(expertId) || []).filter(
      (o) => o.bookingInternalId !== internalKey
    );
    if (list.length) pendingOffersForExpert.set(expertId, list);
    else pendingOffersForExpert.delete(expertId);
  }
  activeBroadcasts.delete(internalKey);
  const ft = failTimers.get(internalKey);
  if (ft) {
    clearTimeout(ft);
    failTimers.delete(internalKey);
  }
}

async function failDispatchIfStillSearching(io, internalKey) {
  const booking = await Booking.findById(internalKey);
  if (!booking || booking.status !== "searching") return;
  booking.status = "cancelled";
  booking.cancelReason = "no_expert_in_sla";
  booking.timeline.cancelledAt = new Date();
  await booking.save();
  notify.emitToRoom(io, `booking:${bookingRoomId(booking)}`, "booking:failed", {
    reason: "no_expert_in_sla",
  });
}

async function runDispatch(io, bookingId) {
  const aborter = { aborted: false };
  dispatchAborters.set(bookingId.toString(), aborter);

  try {
    let booking = await Booking.findById(bookingId).populate("customer", "name phone");
    if (!booking) return;

    booking.status = "searching";
    await booking.save();
    notify.emitToRoom(io, `booking:${bookingRoomId(booking)}`, "booking:status", {
      status: "searching",
    });

    const requiredSkills = getRequiredSkills(booking);
    const candidates = await findBroadcastCandidates(booking, requiredSkills);

    if (candidates.length === 0) {
      const timer = setTimeout(
        () => failDispatchIfStillSearching(io, bookingId.toString()),
        env.DISPATCH_FAIL_AFTER_MS
      );
      failTimers.set(bookingId.toString(), timer);
      return;
    }

    broadcastOffers(io, booking, candidates);
  } finally {
    dispatchAborters.delete(bookingId.toString());
  }
}

async function resolveInternalBookingKey(bookingIdParam) {
  const key = bookingIdParam.toString();
  if (isMongoObjectId(key)) return key;
  const booking = await Booking.findOne({ publicId: key }).select("_id").lean();
  return booking?._id?.toString() || null;
}

async function acceptOffer(io, bookingIdParam, expertId) {
  const internalKey = await resolveInternalBookingKey(bookingIdParam);
  if (!internalKey) return { ok: false, reason: "not_found" };

  const expert = await Expert.findById(expertId);
  if (!expert || expert.status !== "online" || expert.activeBooking) {
    return { ok: false, reason: "expert_unavailable" };
  }

  const booking = await Booking.findOneAndUpdate(
    { _id: internalKey, status: "searching", expert: null },
    {
      expert: expertId,
      status: "assigned",
      "timeline.assignedAt": new Date(),
      sessionOtp: { startCode: genSessionOtp(), endCode: genSessionOtp() },
    },
    { new: true }
  ).populate("customer", "name phone publicId");

  if (!booking) return { ok: false, reason: "already_assigned" };

  const cand = await Expert.findOneAndUpdate(
    { _id: expertId, status: "online", activeBooking: null },
    { status: "on_job", activeBooking: booking._id },
    { new: true }
  );
  if (!cand) {
    await Booking.updateOne(
      { _id: internalKey },
      { expert: null, status: "searching", $unset: { sessionOtp: 1 } }
    );
    return { ok: false, reason: "expert_claim_failed" };
  }

  const distanceKm = geo.haversineKm(
    { lat: expert.lastLocation.lat, lng: expert.lastLocation.lng },
    { lat: booking.location.lat, lng: booking.location.lng }
  );
  booking.quotedEtaMin = Math.round(geo.etaMinutes(distanceKm));
  await booking.save();

  cleanupBroadcast(internalKey);

  notify.emitToRoom(io, `booking:${bookingRoomId(booking)}`, "booking:assigned", {
    status: "assigned",
    expert: {
      id: cand.publicId,
      name: cand.name,
      rating: cand.rating,
      photoUrl: cand.photoUrl,
      phone: cand.phone,
      location: cand.lastLocation,
    },
    quotedEtaMin: booking.quotedEtaMin,
    distanceKm: Math.round(distanceKm * 10) / 10,
  });

  return { ok: true, booking };
}

async function handleExpertResponse(io, bookingIdParam, expertId, accepted) {
  if (!accepted) {
    const internalKey = await resolveInternalBookingKey(bookingIdParam);
    if (internalKey) {
      await Booking.updateOne(
        { _id: internalKey },
        { $addToSet: { declinedBy: expertId } }
      );
    }
    const list = (pendingOffersForExpert.get(expertId.toString()) || []).filter(
      (o) => o.payload.bookingId !== bookingIdParam
    );
    if (list.length) pendingOffersForExpert.set(expertId.toString(), list);
    else pendingOffersForExpert.delete(expertId.toString());
    return true;
  }
  const result = await acceptOffer(io, bookingIdParam, expertId);
  return result.ok;
}

function getPendingOffers(expertId) {
  const now = Date.now();
  const list = (pendingOffersForExpert.get(expertId.toString()) || []).filter(
    (o) => o.expiresAt > now
  );
  pendingOffersForExpert.set(
    expertId.toString(),
    list.filter((o) => o.expiresAt > now)
  );
  return list.map((o) => ({
    ...o.payload,
    offerExpiresInSec: Math.max(1, Math.ceil((o.expiresAt - now) / 1000)),
  }));
}

function getPendingOffer(expertId) {
  const offers = getPendingOffers(expertId);
  return offers[0] || null;
}

function abortDispatch(bookingId) {
  const aborter = dispatchAborters.get(bookingId.toString());
  if (aborter) aborter.aborted = true;
  cleanupBroadcast(bookingId.toString());
}

module.exports = {
  runDispatch,
  handleExpertResponse,
  abortDispatch,
  getPendingOffer,
  getPendingOffers,
  acceptOffer,
};
