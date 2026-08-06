function toPlain(doc) {
  if (!doc) return null;
  return doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
}

function serializePart(part, { includeCost = false } = {}) {
  if (!part) return null;
  const o = toPlain(part);
  const out = {
    id: o.publicId,
    slug: o.slug,
    name: o.name,
    sku: o.sku || "",
    brand: o.brand || "",
    description: o.description || "",
    imageUrl: o.imageUrl || "",
    categories: o.categories || [],
    serviceSlugs: o.serviceSlugs || [],
    kind: o.kind || "part",
    kitItems: (o.kitItems || []).map((k) => ({
      partId: k.partId?.toString?.() || null,
      name: k.name || "",
      qty: k.qty || 1,
    })),
    unit: o.unit || "piece",
    price: o.price,
    taxPercent: o.taxPercent ?? null,
    active: o.active !== false,
    source: o.source || "catalog",
    verificationStatus: o.verificationStatus || "approved",
    usageCount: o.usageCount || 0,
    adminNote: o.adminNote || "",
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
  if (includeCost) {
    out.costPrice = o.costPrice || 0;
    out.createdByExpert = o.createdByExpert?.publicId || o.createdByExpert?.toString?.() || null;
    out.createdByExpertName = o.createdByExpert?.name || null;
  }
  return out;
}

function serializeEstimateLine(line) {
  return {
    id: line._id?.toString(),
    partId: line.partId?.toString?.() || null,
    isCustom: !!line.isCustom,
    name: line.name,
    sku: line.sku || "",
    unit: line.unit || "piece",
    kind: line.kind || "part",
    imageUrl: line.imageUrl || "",
    qty: line.qty,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    proofImages: (line.proofImages || []).map((p) => ({
      url: p.url,
      uploadedAt: p.uploadedAt,
    })),
    installedAt: line.installedAt || null,
  };
}

function serializeEstimate(estimate, { includePaymentRefs = false } = {}) {
  if (!estimate) return null;
  const o = toPlain(estimate);
  const lines = (o.lines || []).map(serializeEstimateLine);
  const partLines = lines.filter((l) => l.kind === "part");
  return {
    id: o.publicId,
    estimateNo: o.estimateNo || "",
    bookingId: o.booking?.publicId || o.booking?.toString?.() || null,
    status: o.status,
    diagnosisNotes: o.diagnosisNotes || "",
    diagnosisImages: o.diagnosisImages || [],
    lines,
    pricing: o.pricing,
    sentAt: o.sentAt || null,
    respondedAt: o.respondedAt || null,
    rejectReason: o.rejectReason || "",
    expiresAt: o.expiresAt || null,
    payment: {
      status: o.payment?.status || "unpaid",
      method: o.payment?.method || null,
      paidAt: o.payment?.paidAt || null,
      cashCollectedAt: o.payment?.cashCollectedAt || null,
      shortUrl: o.payment?.razorpayShortUrl || null,
      ...(includePaymentRefs
        ? {
            razorpayLinkId: o.payment?.razorpayLinkId || null,
            razorpayOrderId: o.payment?.razorpayOrderId || null,
            razorpayPaymentId: o.payment?.razorpayPaymentId || null,
          }
        : {}),
    },
    settled: o.payment?.status === "paid" || !!o.payment?.cashCollectedAt,
    proofComplete: partLines.every((l) => l.proofImages.length > 0),
    expertEarning: o.expertEarning || 0,
    expertName: o.expert?.name || null,
    customerName: o.customer?.name || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function serializePayment(payment) {
  if (!payment) return null;
  const o = toPlain(payment);
  return {
    id: o.publicId,
    kind: o.kind,
    bookingId: o.booking?.publicId || o.booking?.toString?.() || null,
    estimateId: o.estimate?.publicId || o.estimate?.toString?.() || null,
    customerName: o.customer?.name || null,
    customerPhone: o.customer?.phone || null,
    amount: o.amount,
    currency: o.currency || "INR",
    method: o.method,
    status: o.status,
    razorpay: {
      orderId: o.razorpay?.orderId || null,
      paymentId: o.razorpay?.paymentId || null,
      linkId: o.razorpay?.linkId || null,
      shortUrl: o.razorpay?.shortUrl || null,
    },
    cash: {
      collectedAt: o.cash?.collectedAt || null,
    },
    failureReason: o.failureReason || "",
    paidAt: o.paidAt || null,
    createdAt: o.createdAt,
  };
}

module.exports = { serializePart, serializeEstimate, serializeEstimateLine, serializePayment };
