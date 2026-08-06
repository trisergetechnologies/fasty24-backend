/**
 * End-to-end walkthrough of the estimate lifecycle against a running server.
 * Run with: node test/estimate-e2e.js   (requires a seeded DB and `npm start`)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../src/config/env");

const BASE = `http://localhost:${env.PORT}/api/v1`;

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function assert(cond, label, detail) {
  if (!cond) {
    console.error(`[FAIL] ${label}`, detail ?? "");
    process.exitCode = 1;
  } else {
    console.log(`[ok] ${label}`);
  }
}

async function authOtp(phone, role) {
  await call("/auth/request-otp", { method: "POST", body: { phone, role } });
  const verify = await call("/auth/verify-otp", {
    method: "POST",
    body: { phone, code: "123456", role },
  });
  return verify.body;
}

async function main() {
  await mongoose.connect(env.MONGO_URI);
  const Expert = require("../src/models/Expert");
  const Booking = require("../src/models/Booking");
  const Estimate = require("../src/models/Estimate");
  const Part = require("../src/models/Part");
  const Service = require("../src/models/Service");
  const User = require("../src/models/User");

  // ---- customer auth -------------------------------------------------
  const phone = "9100000001";
  let auth = await authOtp(phone, "customer");
  if (auth.registrationToken) {
    auth = (
      await call("/auth/complete-profile", {
        method: "POST",
        token: auth.registrationToken,
        body: { name: "E2E Customer" },
      })
    ).body;
  }
  const customerToken = auth.token;
  assert(!!customerToken, "customer authenticated");

  // ---- expert catalog read -------------------------------------------
  const expert = await Expert.findOne({ skills: "ro_service" }) || (await Expert.findOne());
  assert(!!expert, "seeded expert exists");
  const expertAuth = await authOtp(expert.phone, "expert");
  const expertToken = expertAuth.token;
  assert(!!expertToken, "expert authenticated");

  const parts = await call("/parts?category=ro-service", { token: expertToken });
  assert(parts.status === 200 && parts.body.length > 0, "GET /parts returns RO catalog", parts.body);
  const membrane = parts.body.find((p) => p.sku === "RO-MEM-80");
  assert(!!membrane, "RO membrane present in catalog");

  // ---- build a booking directly in the state the estimate flow needs --
  const service = await Service.findOne({ slug: "ro-filter-replacement" });
  const customer = await User.findOne({ phone: { $regex: phone } });
  const booking = await Booking.create({
    customer: customer._id,
    expert: expert._id,
    status: "in_progress",
    bookingType: "instant",
    items: [
      {
        serviceId: service._id,
        name: service.name,
        skillTag: service.skillTag,
        durationMin: service.durationMin,
        price: service.price,
      },
    ],
    location: { address: "E2E", lat: 28.65, lng: 77.33 },
    pricing: { subtotal: service.price, tax: 0, total: service.price },
    payment: { status: "paid", method: "test" },
    sessionOtp: { endCode: "999999" },
  });

  // ---- create estimate with one catalog + one custom line -------------
  const created = await call(`/bookings/${booking.publicId}/estimates`, {
    method: "POST",
    token: expertToken,
    body: {
      diagnosisNotes: "Membrane choked, TDS high",
      lines: [
        { partId: membrane.id, qty: 1 },
        { name: "Custom brass fitting", unitPrice: 240, qty: 2 },
      ],
    },
  });
  assert(created.status === 201, "estimate created", created.body);
  const estimate = created.body;
  const expectedSubtotal = membrane.price + 240 * 2;
  assert(
    estimate.pricing.subtotal === expectedSubtotal,
    `subtotal priced from catalog (${estimate.pricing.subtotal} == ${expectedSubtotal})`,
  );
  assert(
    estimate.pricing.total === expectedSubtotal + Math.round(expectedSubtotal * 0.18),
    "18% GST applied",
    estimate.pricing,
  );

  const pendingPart = await Part.findOne({ name: "Custom brass fitting" });
  assert(
    pendingPart && pendingPart.verificationStatus === "pending" && pendingPart.source === "expert_custom",
    "custom line queued a pending Part for admin review",
  );
  const publicParts = await call("/parts", { token: expertToken });
  assert(
    !publicParts.body.some((p) => p.name === "Custom brass fitting"),
    "pending part hidden from the expert catalog until approved",
  );

  // ---- completion gate: nothing sent yet, so no block -----------------
  let complete = await call(`/bookings/${booking.publicId}/complete`, {
    method: "POST",
    token: expertToken,
    body: { otp: "000000" },
  });
  assert(
    complete.body.error === "invalid_otp",
    "draft estimate does not gate completion",
    complete.body,
  );

  // ---- send + approve --------------------------------------------------
  const sent = await call(`/estimates/${estimate.id}/send`, { method: "POST", token: expertToken });
  assert(sent.status === 200 && sent.body.status === "sent", "estimate sent", sent.body);

  const approved = await call(`/estimates/${estimate.id}/approve`, {
    method: "POST",
    token: customerToken,
  });
  assert(approved.status === 200 && approved.body.status === "approved", "customer approved", approved.body);

  // ---- gate now blocks on the missing proof photo ---------------------
  complete = await call(`/bookings/${booking.publicId}/complete`, {
    method: "POST",
    token: expertToken,
    body: { otp: "999999" },
  });
  assert(
    complete.status === 400 && complete.body.error === "proof_photo_required",
    "completion blocked until parts are photographed",
    complete.body,
  );

  // ---- upload proof for every part line -------------------------------
  const fresh = await call(`/estimates/${estimate.id}`, { token: expertToken });
  for (const line of fresh.body.lines.filter((l) => l.kind === "part")) {
    const proof = await call(`/estimates/${estimate.id}/lines/${line.id}/proof`, {
      method: "POST",
      token: expertToken,
      body: { url: `https://example.com/proof-${line.id}.jpg` },
    });
    assert(proof.status === 200, `proof uploaded for ${line.name}`, proof.body);
  }

  // ---- gate now blocks on payment -------------------------------------
  complete = await call(`/bookings/${booking.publicId}/complete`, {
    method: "POST",
    token: expertToken,
    body: { otp: "999999" },
  });
  assert(
    complete.status === 400 && complete.body.error === "estimate_unsettled",
    "completion blocked until the estimate is paid",
    complete.body,
  );

  // ---- settle in cash --------------------------------------------------
  const cash = await call(`/estimates/${estimate.id}/payment/cash`, {
    method: "POST",
    token: expertToken,
  });
  assert(cash.status === 200 && cash.body.settled === true, "cash collection settles estimate", cash.body);

  const dupCash = await call(`/estimates/${estimate.id}/payment/cash`, {
    method: "POST",
    token: expertToken,
  });
  assert(dupCash.status === 400 && dupCash.body.error === "already_paid", "double collection rejected");

  // ---- completion now succeeds ----------------------------------------
  complete = await call(`/bookings/${booking.publicId}/complete`, {
    method: "POST",
    token: expertToken,
    body: { otp: "999999" },
  });
  assert(complete.status === 200, "job completes once settled and photographed", complete.body);

  const done = await Booking.findById(booking._id);
  const est = await Estimate.findById(estimate.id ? (await Estimate.findOne({ publicId: estimate.id }))._id : null);
  assert(done.status === "completed", "booking marked completed");
  const { COMMISSION_RATE } = require("../src/services/earnings");
  assert(
    done.expertEarning === Math.round(service.price * COMMISSION_RATE) + est.expertEarning,
    `expert earning is the booking share plus the estimate labour share (${done.expertEarning})`,
  );
  assert(est.expertEarning === 0, "parts pay no commission at the default rate");

  // ---- webhook rejects an unsigned payload ----------------------------
  const badHook = await fetch(`${BASE}/payments/webhook/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-razorpay-signature": "deadbeef" },
    body: JSON.stringify({ event: "payment_link.paid" }),
  });
  assert(badHook.status === 400, "webhook rejects an invalid signature");

  // ---- authorization boundaries ---------------------------------------
  const otherApprove = await call(`/estimates/${estimate.id}/approve`, {
    method: "POST",
    token: expertToken,
  });
  assert(otherApprove.status === 403 || otherApprove.status === 404, "expert cannot approve on the customer's behalf", otherApprove.body);

  // cleanup
  await Estimate.deleteMany({ booking: booking._id });
  await Booking.deleteOne({ _id: booking._id });
  await Part.deleteMany({ source: "expert_custom" });
  await mongoose.disconnect();
  console.log(process.exitCode ? "\n[e2e] FAILURES" : "\n[e2e] all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
