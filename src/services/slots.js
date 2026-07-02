const env = require("../config/env");
const SlotCapacity = require("../models/SlotCapacity");
const Service = require("../models/Service");
const pricing = require("./pricing");
const { isMongoObjectId } = require("../lib/ids");

function parseWindow(windowStr) {
  const [startH, endH] = windowStr.split("-").map((n) => parseInt(n, 10));
  return { startH, endH };
}

function buildSlotId(dateStr, windowStr) {
  return `${dateStr}_${windowStr.replace("-", "")}`;
}

function windowDates(dateStr, windowStr) {
  const { startH, endH } = parseWindow(windowStr);
  const base = new Date(`${dateStr}T00:00:00`);
  const windowStart = new Date(base);
  windowStart.setHours(startH, 0, 0, 0);
  const windowEnd = new Date(base);
  windowEnd.setHours(endH, 0, 0, 0);
  return { windowStart, windowEnd };
}

async function getAvailableSlots({ serviceId, date, lat, lng }) {
  if (!serviceId || !date || lat == null || lng == null) {
    throw Object.assign(new Error("missing_params"), { statusCode: 400 });
  }

  const service = isMongoObjectId(serviceId)
    ? await Service.findById(serviceId)
    : await Service.findOne({ slug: serviceId, active: true });
  if (!service) throw Object.assign(new Error("service_not_found"), { statusCode: 404 });

  const zone = await pricing.resolveZone(parseFloat(lat), parseFloat(lng));
  if (!zone) throw Object.assign(new Error("outside_service_area"), { statusCode: 400 });
  const zoneSlug = zone.slug;
  const categorySlug = service.categories[0] || service.skillTag;
  const now = new Date();
  const slots = [];

  for (const windowStr of env.SLOT_WINDOWS) {
    const slotId = buildSlotId(date, windowStr);
    const { windowStart, windowEnd } = windowDates(date, windowStr);
    if (windowStart <= now) continue;

    let cap = await SlotCapacity.findOne({ zoneSlug, categorySlug, slotId, date });
    if (!cap) {
      cap = { bookedCount: 0, maxCapacity: env.SLOT_MAX_CAPACITY };
    }
    const available = cap.bookedCount < cap.maxCapacity;
    slots.push({
      slotId,
      date,
      window: windowStr,
      windowStart,
      windowEnd,
      available,
      remaining: Math.max(0, cap.maxCapacity - cap.bookedCount),
    });
  }

  return { zoneSlug, serviceSlug: service.slug, slots };
}

async function reserveSlot({ zoneSlug, categorySlug, slotId, date, windowStart, windowEnd }) {
  const cap = await SlotCapacity.findOneAndUpdate(
    { zoneSlug, categorySlug, slotId, date },
    {
      $setOnInsert: {
        zoneSlug,
        categorySlug,
        slotId,
        date,
        windowStart,
        windowEnd,
        maxCapacity: env.SLOT_MAX_CAPACITY,
      },
      $inc: { bookedCount: 1 },
    },
    { upsert: true, new: true }
  );
  if (cap.bookedCount > cap.maxCapacity) {
    await SlotCapacity.updateOne({ _id: cap._id }, { $inc: { bookedCount: -1 } });
    throw Object.assign(new Error("slot_full"), { statusCode: 409 });
  }
  return cap;
}

async function releaseSlot({ zoneSlug, categorySlug, slotId, date }) {
  await SlotCapacity.updateOne(
    { zoneSlug, categorySlug, slotId, date, bookedCount: { $gt: 0 } },
    { $inc: { bookedCount: -1 } }
  );
}

module.exports = {
  getAvailableSlots,
  reserveSlot,
  releaseSlot,
  buildSlotId,
  windowDates,
};
