const asyncHandler = require("express-async-handler");
const Booking = require("../models/Booking");
const Estimate = require("../models/Estimate");
const Payment = require("../models/Payment");
const User = require("../models/User");
const env = require("../config/env");
const rzp = require("../services/razorpay");
const estimatesService = require("../services/estimates");
const dispatcher = require("../services/dispatcher");
const scheduling = require("../services/scheduling");
const notify = require("../services/notify");
const { findByPublicId, bookingRoomId } = require("../lib/ids");
const { loadExpertFromAuth } = require("../lib/expertAuth");
const { serializeBooking } = require("../lib/serialize");
const { serializeEstimate, serializePayment } = require("../lib/serializeCommerce");

async function loadCustomerContact(customerId) {
  if (!customerId) return {};
  const user = await User.findById(customerId).select("name phone email").lean();
  return { name: user?.name, phone: user?.phone, email: user?.email };
}

/* ------------------------------------------------------------------ */
/* Estimate settlement                                                 */
/* ------------------------------------------------------------------ */

/** Expert taps "Show QR" — creates (or reuses) a payment link and renders it as a QR. */
const createEstimateLink = asyncHandler(async (req, res) => {
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) return res.status(404).json({ error: "not_found" });
  const estimate = await findByPublicId(Estimate, req.params.id, { expert: expert._id });
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (estimate.status !== "approved") {
    return res.status(400).json({ error: "invalid_status", message: "The customer has not approved this estimate yet." });
  }
  if (estimate.isSettled()) {
    return res.status(400).json({ error: "already_paid", message: "This estimate is already settled." });
  }
  if (!rzp.isEnabled()) {
    return res.status(503).json({
      error: "razorpay_disabled",
      message: "Online payments are not configured. Collect cash instead.",
    });
  }

  // Reuse an open link so re-opening the sheet does not spawn duplicates
  if (estimate.payment.razorpayShortUrl && estimate.payment.razorpayLinkId) {
    const qr = await rzp.qrDataUrl(estimate.payment.razorpayShortUrl);
    return res.json({
      shortUrl: estimate.payment.razorpayShortUrl,
      linkId: estimate.payment.razorpayLinkId,
      qrDataUrl: qr,
      amount: estimate.pricing.total,
      status: estimate.payment.status,
    });
  }

  const contact = await loadCustomerContact(estimate.customer);
  const link = await rzp.createPaymentLink({
    amount: estimate.pricing.total,
    description: `Fasty24 ${estimate.estimateNo} - parts & repair`,
    customer: contact,
    notes: { kind: "estimate", estimateId: estimate.publicId },
    expireBySec: Math.floor(Date.now() / 1000) + 24 * 3600,
  });

  estimate.payment.status = "pending";
  estimate.payment.method = "razorpay";
  estimate.payment.razorpayLinkId = link.id;
  estimate.payment.razorpayShortUrl = link.short_url;
  await estimate.save();

  await Payment.create({
    kind: "estimate",
    booking: estimate.booking,
    estimate: estimate._id,
    customer: estimate.customer,
    amount: estimate.pricing.total,
    method: "razorpay",
    status: "created",
    razorpay: { linkId: link.id, shortUrl: link.short_url },
  });

  const qrDataUrl = await rzp.qrDataUrl(link.short_url);
  res.status(201).json({
    shortUrl: link.short_url,
    linkId: link.id,
    qrDataUrl,
    amount: estimate.pricing.total,
    status: "pending",
  });
});

/** Customer taps "Pay now" in their own app — same link, opened in a browser. */
const customerEstimateLink = asyncHandler(async (req, res) => {
  const estimate = await findByPublicId(Estimate, req.params.id, { customer: req.auth.sub });
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (estimate.status !== "approved") return res.status(400).json({ error: "invalid_status" });
  if (estimate.isSettled()) return res.status(400).json({ error: "already_paid" });
  if (!rzp.isEnabled()) return res.status(503).json({ error: "razorpay_disabled" });

  if (!estimate.payment.razorpayShortUrl) {
    const contact = await loadCustomerContact(estimate.customer);
    const link = await rzp.createPaymentLink({
      amount: estimate.pricing.total,
      description: `Fasty24 ${estimate.estimateNo} - parts & repair`,
      customer: contact,
      notes: { kind: "estimate", estimateId: estimate.publicId },
      expireBySec: Math.floor(Date.now() / 1000) + 24 * 3600,
    });
    estimate.payment.status = "pending";
    estimate.payment.method = "razorpay";
    estimate.payment.razorpayLinkId = link.id;
    estimate.payment.razorpayShortUrl = link.short_url;
    await estimate.save();
    await Payment.create({
      kind: "estimate",
      booking: estimate.booking,
      estimate: estimate._id,
      customer: estimate.customer,
      amount: estimate.pricing.total,
      method: "razorpay",
      status: "created",
      razorpay: { linkId: link.id, shortUrl: link.short_url },
    });
  }

  res.json({
    shortUrl: estimate.payment.razorpayShortUrl,
    amount: estimate.pricing.total,
    status: estimate.payment.status,
  });
});

/** Expert marks the estimate paid in cash. */
const markEstimateCash = asyncHandler(async (req, res) => {
  const expert = await loadExpertFromAuth(req.auth);
  if (!expert) return res.status(404).json({ error: "not_found" });
  const estimate = await findByPublicId(Estimate, req.params.id, { expert: expert._id });
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (estimate.status !== "approved") return res.status(400).json({ error: "invalid_status" });
  if (estimate.isSettled()) return res.status(400).json({ error: "already_paid" });

  const now = new Date();
  estimate.payment.status = "paid";
  estimate.payment.method = "cash";
  estimate.payment.cashCollectedAt = now;
  estimate.payment.paidAt = now;
  await estimate.save();

  await Payment.create({
    kind: "estimate",
    booking: estimate.booking,
    estimate: estimate._id,
    customer: estimate.customer,
    amount: estimate.pricing.total,
    method: "cash",
    status: "paid",
    cash: { collectedByExpert: expert._id, collectedAt: now },
    paidAt: now,
  });

  // Cancel any open link so the customer cannot double-pay online
  if (estimate.payment.razorpayLinkId) {
    try {
      await rzp.cancelPaymentLink(estimate.payment.razorpayLinkId);
    } catch (err) {
      console.warn("[payment] link cancel failed", err.message);
    }
  }

  const booking = await Booking.findById(estimate.booking);
  if (booking) {
    await estimatesService.emitEstimateEvent(req.app.get("io"), {
      estimate,
      booking,
      event: "estimate:paid",
      extra: { method: "cash" },
    });
  }

  res.json(serializeEstimate(estimate));
});

const estimatePaymentStatus = asyncHandler(async (req, res) => {
  const estimate = await findByPublicId(Estimate, req.params.id);
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

  // Webhooks can be delayed or blocked in dev; reconcile against Razorpay on demand
  if (
    estimate.payment.status === "pending" &&
    estimate.payment.razorpayLinkId &&
    rzp.isEnabled()
  ) {
    try {
      const link = await rzp.fetchPaymentLink(estimate.payment.razorpayLinkId);
      if (link?.status === "paid") {
        await settleEstimatePaid(estimate, {
          paymentId: link.payments?.[0]?.payment_id || "",
          io: req.app.get("io"),
        });
      }
    } catch (err) {
      console.warn("[payment] link poll failed", err.message);
    }
  }

  res.json({
    status: estimate.payment.status,
    method: estimate.payment.method,
    paidAt: estimate.payment.paidAt,
    settled: estimate.isSettled(),
    amount: estimate.pricing.total,
  });
});

/** Shared settle path used by both the webhook and the on-demand poll. */
async function settleEstimatePaid(estimate, { paymentId, orderId, signature, io, eventId } = {}) {
  if (estimate.payment.status === "paid") return estimate;
  const now = new Date();
  estimate.payment.status = "paid";
  estimate.payment.method = "razorpay";
  estimate.payment.razorpayPaymentId = paymentId || estimate.payment.razorpayPaymentId;
  if (orderId) estimate.payment.razorpayOrderId = orderId;
  estimate.payment.paidAt = now;
  await estimate.save();

  const set = { status: "paid", paidAt: now, "razorpay.paymentId": paymentId || null };
  if (orderId) set["razorpay.orderId"] = orderId;
  if (signature) set["razorpay.signature"] = signature;

  const filter = orderId
    ? {
        $or: [
          { estimate: estimate._id, method: "razorpay", status: { $ne: "paid" } },
          { "razorpay.orderId": orderId, status: { $ne: "paid" } },
        ],
      }
    : { estimate: estimate._id, method: "razorpay", status: { $ne: "paid" } };

  await Payment.updateOne(
    filter,
    eventId ? { $set: set, $addToSet: { webhookEventIds: eventId } } : { $set: set }
  );

  const booking = await Booking.findById(estimate.booking);
  if (booking && io) {
    await estimatesService.emitEstimateEvent(io, {
      estimate,
      booking,
      event: "estimate:paid",
      extra: { method: "razorpay" },
    });
  }
  await estimatesService.pushToExpert(
    estimate,
    "Payment received",
    `₹${estimate.pricing.total} received for ${estimate.estimateNo}.`,
    { estimateId: estimate.publicId, kind: "estimate_paid" }
  );
  return estimate;
}

/* ------------------------------------------------------------------ */
/* Upfront booking fee                                                 */
/* ------------------------------------------------------------------ */

const createBookingLink = asyncHandler(async (req, res) => {
  const booking = await findByPublicId(Booking, req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (booking.payment.status === "paid") {
    return res.status(400).json({ error: "already_paid" });
  }
  if (!rzp.isEnabled()) return res.status(503).json({ error: "razorpay_disabled" });

  const contact = await loadCustomerContact(booking.customer);
  const link = await rzp.createPaymentLink({
    amount: booking.pricing.total,
    description: `Fasty24 booking ${booking.publicId.slice(0, 8)}`,
    customer: contact,
    notes: { kind: "booking", bookingId: booking.publicId },
    expireBySec: Math.floor(Date.now() / 1000) + 3 * 3600,
  });

  booking.payment.status = "authorized";
  booking.payment.method = "razorpay";
  booking.payment.providerRef = link.id;
  await booking.save();

  await Payment.create({
    kind: "booking",
    booking: booking._id,
    customer: booking.customer,
    amount: booking.pricing.total,
    method: "razorpay",
    status: "created",
    razorpay: { linkId: link.id, shortUrl: link.short_url },
  });

  res.status(201).json({
    shortUrl: link.short_url,
    linkId: link.id,
    qrDataUrl: await rzp.qrDataUrl(link.short_url),
    amount: booking.pricing.total,
  });
});

const bookingPaymentStatus = asyncHandler(async (req, res) => {
  const booking = await findByPublicId(Booking, req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });

  if (
    booking.payment.status !== "paid" &&
    booking.payment.method === "razorpay" &&
    booking.payment.providerRef &&
    rzp.isEnabled() &&
    String(booking.payment.providerRef).startsWith("plink_")
  ) {
    try {
      const link = await rzp.fetchPaymentLink(booking.payment.providerRef);
      if (link?.status === "paid") {
        await settleBookingPaid(booking, {
          paymentId: link.payments?.[0]?.payment_id || "",
          io: req.app.get("io"),
        });
      }
    } catch (err) {
      console.warn("[payment] booking link poll failed", err.message);
    }
  }

  res.json({
    status: booking.payment.status,
    method: booking.payment.method,
    bookingStatus: booking.status,
    amount: booking.pricing.total,
  });
});

/** Marks the booking paid and kicks off dispatch, mirroring bookings.confirmPayment. */
async function settleBookingPaid(booking, { paymentId, orderId, signature, io, eventId } = {}) {
  if (booking.payment.status === "paid") return booking;
  booking.payment.status = "paid";
  booking.payment.method = "razorpay";
  if (paymentId) booking.payment.providerRef = paymentId;

  const shouldSchedule = booking.bookingType === "scheduled" && booking.scheduledSlot?.windowStart;
  if (shouldSchedule) booking.status = "scheduled";
  await booking.save();

  const set = {
    status: "paid",
    paidAt: new Date(),
    "razorpay.paymentId": paymentId || null,
  };
  if (orderId) set["razorpay.orderId"] = orderId;
  if (signature) set["razorpay.signature"] = signature;

  const filter = orderId
    ? {
        $or: [
          { booking: booking._id, kind: "booking", status: { $ne: "paid" } },
          { "razorpay.orderId": orderId, status: { $ne: "paid" } },
        ],
      }
    : { booking: booking._id, kind: "booking", status: { $ne: "paid" } };

  await Payment.updateOne(
    filter,
    eventId ? { $set: set, $addToSet: { webhookEventIds: eventId } } : { $set: set }
  );

  if (shouldSchedule) {
    scheduling.scheduleDispatch(io, booking._id, booking.scheduledSlot.windowStart);
  } else {
    setImmediate(() => dispatcher.runDispatch(io, booking._id));
  }

  notify.emitToRoom(io, `booking:${bookingRoomId(booking)}`, "booking:update", {
    status: booking.status,
    payment: booking.payment,
  });
  return booking;
}

/* ------------------------------------------------------------------ */
/* Native Checkout (Orders + signature verify)                         */
/* ------------------------------------------------------------------ */

/** Customer opens the Razorpay native sheet for an estimate. */
const createEstimateOrder = asyncHandler(async (req, res) => {
  const estimate = await findByPublicId(Estimate, req.params.id, { customer: req.auth.sub });
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (estimate.status !== "approved") return res.status(400).json({ error: "invalid_status" });
  if (estimate.isSettled()) return res.status(400).json({ error: "already_paid" });
  if (!rzp.isEnabled()) return res.status(503).json({ error: "razorpay_disabled" });

  const contact = await loadCustomerContact(estimate.customer);
  const order = await rzp.createOrder({
    amount: estimate.pricing.total,
    receipt: `est_${estimate.publicId}`.slice(0, 40),
    notes: { kind: "estimate", estimateId: estimate.publicId },
  });

  estimate.payment.status = "pending";
  estimate.payment.method = "razorpay";
  estimate.payment.razorpayOrderId = order.id;
  await estimate.save();

  await Payment.findOneAndUpdate(
    { estimate: estimate._id, "razorpay.orderId": order.id },
    {
      $setOnInsert: {
        kind: "estimate",
        booking: estimate.booking,
        estimate: estimate._id,
        customer: estimate.customer,
        amount: estimate.pricing.total,
        method: "razorpay",
        status: "created",
        razorpay: { orderId: order.id },
      },
    },
    { upsert: true, new: true }
  );

  res.status(201).json({
    keyId: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount: estimate.pricing.total,
    amountPaise: order.amount,
    currency: order.currency || "INR",
    name: "Fasty24",
    description: `${estimate.estimateNo} — parts & repair`,
    prefill: {
      name: contact.name || "",
      contact: contact.phone || "",
      email: contact.email || "",
    },
  });
});

const verifyEstimateOrder = asyncHandler(async (req, res) => {
  const estimate = await findByPublicId(Estimate, req.params.id, { customer: req.auth.sub });
  if (!estimate) return res.status(404).json({ error: "not_found" });
  if (estimate.isSettled()) return res.json(serializeEstimate(estimate));

  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
    req.body || {};
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "missing_params" });
  }
  if (!rzp.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    return res.status(400).json({ error: "invalid_signature" });
  }
  if (estimate.payment.razorpayOrderId && estimate.payment.razorpayOrderId !== orderId) {
    return res.status(400).json({ error: "order_mismatch" });
  }

  await settleEstimatePaid(estimate, {
    paymentId,
    orderId,
    signature,
    io: req.app.get("io"),
  });
  res.json(serializeEstimate(estimate));
});

/** Customer opens the Razorpay native sheet for the upfront booking fee. */
const createBookingOrder = asyncHandler(async (req, res) => {
  const booking = await findByPublicId(Booking, req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (booking.payment.status === "paid") return res.status(400).json({ error: "already_paid" });
  if (!rzp.isEnabled()) return res.status(503).json({ error: "razorpay_disabled" });

  const contact = await loadCustomerContact(booking.customer);
  const order = await rzp.createOrder({
    amount: booking.pricing.total,
    receipt: `bk_${booking.publicId}`.slice(0, 40),
    notes: { kind: "booking", bookingId: booking.publicId },
  });

  booking.payment.status = "authorized";
  booking.payment.method = "razorpay";
  booking.payment.providerRef = order.id;
  await booking.save();

  await Payment.findOneAndUpdate(
    { booking: booking._id, kind: "booking", "razorpay.orderId": order.id },
    {
      $setOnInsert: {
        kind: "booking",
        booking: booking._id,
        customer: booking.customer,
        amount: booking.pricing.total,
        method: "razorpay",
        status: "created",
        razorpay: { orderId: order.id },
      },
    },
    { upsert: true, new: true }
  );

  res.status(201).json({
    keyId: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount: booking.pricing.total,
    amountPaise: order.amount,
    currency: order.currency || "INR",
    name: "Fasty24",
    description: `Booking ${booking.publicId.slice(0, 8)}`,
    prefill: {
      name: contact.name || "",
      contact: contact.phone || "",
      email: contact.email || "",
    },
  });
});

const verifyBookingOrder = asyncHandler(async (req, res) => {
  const booking = await findByPublicId(Booking, req.params.id, { customer: req.auth.sub });
  if (!booking) return res.status(404).json({ error: "not_found" });
  if (booking.payment.status === "paid") {
    return res.json(serializeBooking(booking));
  }

  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
    req.body || {};
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "missing_params" });
  }
  if (!rzp.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    return res.status(400).json({ error: "invalid_signature" });
  }
  if (booking.payment.providerRef && booking.payment.providerRef !== orderId) {
    return res.status(400).json({ error: "order_mismatch" });
  }

  await settleBookingPaid(booking, {
    paymentId,
    orderId,
    signature,
    io: req.app.get("io"),
  });

  const populated = await Booking.findById(booking._id)
    .populate("expert", "name rating photoUrl phone lastLocation publicId")
    .populate("customer", "name phone publicId");
  res.json(serializeBooking(populated || booking));
});

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  if (!rzp.verifyWebhookSignature(req.rawBody, signature)) {
    return res.status(400).json({ error: "invalid_signature" });
  }

  const event = req.body?.event;
  const eventId = req.headers["x-razorpay-event-id"] || "";
  const io = req.app.get("io");

  // Acknowledge fast; Razorpay retries on non-2xx
  res.json({ ok: true });

  try {
    if (eventId) {
      const seen = await Payment.exists({ webhookEventIds: eventId });
      if (seen) return;
    }

    if (event === "payment_link.paid") {
      const link = req.body?.payload?.payment_link?.entity;
      const payment = req.body?.payload?.payment?.entity;
      if (!link?.id) return;

      const estimate = await Estimate.findOne({ "payment.razorpayLinkId": link.id });
      if (estimate) {
        await settleEstimatePaid(estimate, { paymentId: payment?.id, io, eventId });
        return;
      }
      const booking = await Booking.findOne({ "payment.providerRef": link.id });
      if (booking) {
        await settleBookingPaid(booking, { paymentId: payment?.id, io, eventId });
      }
      return;
    }

    if (event === "payment.captured") {
      const payment = req.body?.payload?.payment?.entity;
      const notes = payment?.notes || {};
      if (notes.kind === "estimate" && notes.estimateId) {
        const estimate = await Estimate.findOne({ publicId: notes.estimateId });
        if (estimate) {
          await settleEstimatePaid(estimate, {
            paymentId: payment.id,
            orderId: payment.order_id,
            io,
            eventId,
          });
        }
      } else if (notes.kind === "booking" && notes.bookingId) {
        const booking = await Booking.findOne({ publicId: notes.bookingId });
        if (booking) {
          await settleBookingPaid(booking, {
            paymentId: payment.id,
            orderId: payment.order_id,
            io,
            eventId,
          });
        }
      } else if (payment?.order_id) {
        // Native Checkout often only has the order id available on the webhook
        const byOrder = await Payment.findOne({ "razorpay.orderId": payment.order_id });
        if (byOrder?.kind === "estimate" && byOrder.estimate) {
          const estimate = await Estimate.findById(byOrder.estimate);
          if (estimate) {
            await settleEstimatePaid(estimate, {
              paymentId: payment.id,
              orderId: payment.order_id,
              io,
              eventId,
            });
          }
        } else if (byOrder?.kind === "booking" && byOrder.booking) {
          const booking = await Booking.findById(byOrder.booking);
          if (booking) {
            await settleBookingPaid(booking, {
              paymentId: payment.id,
              orderId: payment.order_id,
              io,
              eventId,
            });
          }
        }
      }
      return;
    }

    if (event === "payment.failed") {
      const payment = req.body?.payload?.payment?.entity;
      const notes = payment?.notes || {};
      const reason = payment?.error_description || "Payment failed";
      if (notes.kind === "estimate" && notes.estimateId) {
        await Estimate.updateOne(
          { publicId: notes.estimateId, "payment.status": { $ne: "paid" } },
          { $set: { "payment.status": "failed" } }
        );
      }
      await Payment.updateOne(
        { "razorpay.orderId": payment?.order_id, status: { $ne: "paid" } },
        { $set: { status: "failed", failureReason: reason }, $addToSet: { webhookEventIds: eventId } }
      );
    }
  } catch (err) {
    console.error("[payment] webhook handling failed", err);
  }
});

const adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.status) filter.status = req.query.status;
  const payments = await Payment.find(filter)
    .populate("booking", "publicId")
    .populate("estimate", "publicId estimateNo")
    .populate("customer", "name phone")
    .sort({ createdAt: -1 })
    .limit(300);
  res.json(payments.map(serializePayment));
});

module.exports = {
  createEstimateLink,
  customerEstimateLink,
  markEstimateCash,
  estimatePaymentStatus,
  createEstimateOrder,
  verifyEstimateOrder,
  createBookingLink,
  createBookingOrder,
  verifyBookingOrder,
  bookingPaymentStatus,
  webhook,
  adminList,
  settleEstimatePaid,
  settleBookingPaid,
};
