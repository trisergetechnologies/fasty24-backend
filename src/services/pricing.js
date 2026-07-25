const Zone = require("../models/Zone");
const Service = require("../models/Service");
const geo = require("./geo");
const env = require("../config/env");

function serviceAreaFallbackZone() {
  return {
    slug: env.SERVICE_AREA_SLUG,
    name: env.SERVICE_AREA_NAME,
    city: env.SERVICE_AREA_CITY,
    active: true,
    _fallback: true,
  };
}

function isWithinConfiguredServiceArea(lat, lng) {
  // Service area mandate disabled — all coordinates are accepted.
  if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
  return false;
}

async function resolveZone(lat, lng) {
  const cell = geo.toCell(lat, lng);
  const zone = await Zone.findOne({ h3Cells: cell, active: true }).lean();
  if (zone) return zone;
  // Open booking for every location — always fall back when no polygon zone matches.
  return serviceAreaFallbackZone();
}

async function getServicePrice(service, _zone) {
  return service.price;
}

async function priceServices(services) {
  return services.map((s) => ({ ...s.toObject(), price: s.price }));
}

module.exports = {
  resolveZone,
  getServicePrice,
  priceServices,
  isWithinConfiguredServiceArea,
  serviceAreaFallbackZone,
};
