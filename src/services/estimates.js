const Estimate = require("../models/Estimate");
const User = require("../models/User");
const Expert = require("../models/Expert");
const notify = require("./notify");
const env = require("../config/env");
const { bookingRoomId } = require("../lib/ids");
const { serializeEstimate } = require("../lib/serializeCommerce");

/** Expert keeps a share of labour lines only; parts are pass-through by default. */
function computeEstimateEarning(estimate) {
  let earning = 0;
  (estimate.lines || []).forEach((line) => {
    const rate =
      line.kind === "labour"
        ? env.ESTIMATE_LABOUR_COMMISSION_RATE
        : env.ESTIMATE_PARTS_COMMISSION_RATE;
    earning += (line.lineTotal || 0) * rate;
  });
  return Math.round(earning);
}

/**
 * Blocks job completion until every approved estimate is settled and every
 * installed part has a proof photo. Returns null when the booking is clear.
 */
async function checkBookingSettlement(bookingId) {
  const approved = await Estimate.find({ booking: bookingId, status: "approved" });
  if (!approved.length) return null;

  // Proof first: the expert installs and photographs the part, then collects payment
  if (env.REQUIRE_PART_PROOF_PHOTO) {
    for (const est of approved) {
      const missing = (est.lines || []).find(
        (line) => line.kind === "part" && (line.proofImages || []).length === 0
      );
      if (missing) {
        return {
          error: "proof_photo_required",
          message: `Upload a photo of the installed "${missing.name}" before completing the job.`,
          estimateId: est.publicId,
          lineId: missing._id?.toString(),
        };
      }
    }
  }

  const unsettled = approved.find((est) => !est.isSettled());
  if (unsettled) {
    return {
      error: "estimate_unsettled",
      message: `Collect payment for estimate ${unsettled.estimateNo || ""} before completing the job.`.trim(),
      estimateId: unsettled.publicId,
    };
  }

  return null;
}

/** Total labour earning across all settled estimates on a booking. */
async function bookingEstimateEarning(bookingId) {
  const settled = await Estimate.find({ booking: bookingId, status: "approved" });
  return settled
    .filter((est) => est.isSettled())
    .reduce((sum, est) => sum + (est.expertEarning || 0), 0);
}

async function emitEstimateEvent(io, { estimate, booking, event, extra = {} }) {
  const room = `booking:${bookingRoomId(booking)}`;
  notify.emitToRoom(io, room, event, {
    estimate: serializeEstimate(estimate),
    bookingId: booking.publicId,
    ...extra,
  });
  const expertId = estimate.expert?._id || estimate.expert;
  if (expertId) {
    notify.emitToRoom(io, `expert:${expertId.toString()}`, event, {
      estimate: serializeEstimate(estimate),
      bookingId: booking.publicId,
      ...extra,
    });
  }
}

async function pushToCustomer(estimate, title, body, data = {}) {
  try {
    const customerId = estimate.customer?._id || estimate.customer;
    if (!customerId) return;
    const customer = await User.findById(customerId).select("pushToken").lean();
    await notify.expoPush(customer?.pushToken, title, body, data);
  } catch (err) {
    console.warn("[estimates] customer push failed", err.message);
  }
}

async function pushToExpert(estimate, title, body, data = {}) {
  try {
    const expertId = estimate.expert?._id || estimate.expert;
    if (!expertId) return;
    const expert = await Expert.findById(expertId).select("pushToken").lean();
    await notify.expoPush(expert?.pushToken, title, body, data);
  } catch (err) {
    console.warn("[estimates] expert push failed", err.message);
  }
}

module.exports = {
  computeEstimateEarning,
  checkBookingSettlement,
  bookingEstimateEarning,
  emitEstimateEvent,
  pushToCustomer,
  pushToExpert,
};
