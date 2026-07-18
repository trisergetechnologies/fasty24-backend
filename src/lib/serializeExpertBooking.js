const COMMISSION_RATE = 0.85;

function serializeBookingForExpert(booking, base) {
  const o = booking.toObject ? booking.toObject() : booking;
  const items = o.items || [];
  const primary = items.find((it) => !it.isAddOn) || items[0];
  const subtotal = o.pricing?.subtotal || 0;
  const totalAmount = o.pricing?.total || 0;
  const expertEarning =
    typeof o.expertEarning === "number" && Number.isFinite(o.expertEarning)
      ? o.expertEarning
      : Math.round(subtotal * COMMISSION_RATE);

  return {
    ...base,
    serviceName: items.map((i) => i.name).filter(Boolean).join(", ") || "Service",
    serviceId: primary?.serviceId?.toString?.() || primary?._id?.toString?.() || "",
    customerName: o.customer?.name || base.customer?.name || "Customer",
    customerPhone: o.customer?.phone || "",
    scheduledAt: o.scheduledFor || o.scheduledSlot?.windowStart || o.createdAt || null,
    totalAmount,
    expertEarning,
    address: o.location?.address || "",
    paymentMethod: o.payment?.method || o.payment?.status || "Online",
    arrivedAt: o.timeline?.arrivedAt || null,
    jobTimer: o.jobTimer || null,
    scheduledSlot: o.scheduledSlot || null,
    sessionOtp: o.sessionOtp
      ? {
          startVerified: !!o.sessionOtp.startVerifiedAt,
          endVerified: !!o.sessionOtp.endVerifiedAt,
          requiresStartOtp:
            ["assigned", "travelling", "arrived"].includes(o.status) &&
            !!o.sessionOtp.startCode &&
            !o.sessionOtp.startVerifiedAt,
          requiresEndOtp:
            o.status === "in_progress" &&
            !!o.sessionOtp.endCode &&
            !o.sessionOtp.endVerifiedAt,
          // Expert enters OTP verbally from customer — never expose codes in expert API
        }
      : null,
  };
}

module.exports = { serializeBookingForExpert, COMMISSION_RATE };
