const crypto = require("crypto");
const Razorpay = require("razorpay");
const QRCode = require("qrcode");
const env = require("../config/env");

let client = null;

function isEnabled() {
  return !!(env.RAZORPAY_ENABLED && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}

function toPaise(rupees) {
  return Math.round(Number(rupees || 0) * 100);
}

function disabledError() {
  return Object.assign(new Error("razorpay_disabled"), {
    statusCode: 503,
    expose: true,
    message: "Online payments are not configured. Set RAZORPAY_ENABLED and the API keys.",
  });
}

async function createOrder({ amount, receipt, notes = {} }) {
  const rzp = getClient();
  if (!rzp) throw disabledError();
  const amountPaise = toPaise(amount);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    const err = Object.assign(new Error("amount_too_small"), {
      statusCode: 400,
      expose: true,
      message: "Minimum payment amount is ₹1 (100 paise).",
    });
    throw err;
  }
  return rzp.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: String(receipt || "").slice(0, 40),
    notes,
    payment_capture: 1,
  });
}

async function createPaymentLink({ amount, description, customer = {}, notes = {}, expireBySec }) {
  const rzp = getClient();
  if (!rzp) throw disabledError();
  const payload = {
    amount: toPaise(amount),
    currency: "INR",
    description: String(description || "Fasty24 payment").slice(0, 2048),
    customer: {
      name: customer.name || "Customer",
      ...(customer.phone ? { contact: normalizeContact(customer.phone) } : {}),
      ...(customer.email ? { email: customer.email } : {}),
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes,
  };
  if (env.PAYMENT_CALLBACK_URL) {
    payload.callback_url = env.PAYMENT_CALLBACK_URL;
    payload.callback_method = "get";
  }
  // Razorpay requires expire_by to be at least 15 minutes out
  if (expireBySec && expireBySec > Math.floor(Date.now() / 1000) + 900) {
    payload.expire_by = expireBySec;
  }
  return rzp.paymentLink.create(payload);
}

async function fetchPaymentLink(linkId) {
  const rzp = getClient();
  if (!rzp) throw disabledError();
  return rzp.paymentLink.fetch(linkId);
}

async function cancelPaymentLink(linkId) {
  const rzp = getClient();
  if (!rzp) throw disabledError();
  return rzp.paymentLink.cancel(linkId);
}

async function fetchPayment(paymentId) {
  const rzp = getClient();
  if (!rzp) throw disabledError();
  return rzp.payments.fetch(paymentId);
}

function normalizeContact(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

function hmac(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Checkout handshake: razorpay_order_id|razorpay_payment_id signed with the key secret. */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!env.RAZORPAY_KEY_SECRET || !orderId || !paymentId || !signature) return false;
  return safeEqual(hmac(`${orderId}|${paymentId}`, env.RAZORPAY_KEY_SECRET), signature);
}

/** Payment-link redirect handshake uses a different, documented payload shape. */
function verifyPaymentLinkSignature({ linkId, linkRefId, linkStatus, paymentId, signature }) {
  if (!env.RAZORPAY_KEY_SECRET || !signature) return false;
  const payload = `${linkId}|${linkRefId || ""}|${linkStatus}|${paymentId}`;
  return safeEqual(hmac(payload, env.RAZORPAY_KEY_SECRET), signature);
}

function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !rawBody || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  return safeEqual(hmac(body, env.RAZORPAY_WEBHOOK_SECRET), signature);
}

/**
 * Renders a payment URL as a PNG data URI so the expert app can display a
 * scannable QR with a plain <Image> and no extra native dependency.
 */
async function qrDataUrl(url) {
  if (!url) return null;
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: 512, errorCorrectionLevel: "M" });
  } catch (err) {
    console.warn("[razorpay] qr generation failed", err.message);
    return null;
  }
}

module.exports = {
  isEnabled,
  toPaise,
  createOrder,
  createPaymentLink,
  fetchPaymentLink,
  cancelPaymentLink,
  fetchPayment,
  verifyCheckoutSignature,
  verifyPaymentLinkSignature,
  verifyWebhookSignature,
  qrDataUrl,
};
