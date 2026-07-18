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
  const distanceKm = geo.haversineKm(
    { lat, lng },
    { lat: env.SERVICE_AREA_LAT, lng: env.SERVICE_AREA_LNG }
  );
  return distanceKm <= env.SERVICE_AREA_RADIUS_KM;
}

async function resolveZone(lat, lng) {
  const cell = geo.toCell(lat, lng);
  const zone = await Zone.findOne({ h3Cells: cell, active: true }).lean();
  if (zone) return zone;
  if (isWithinConfiguredServiceArea(lat, lng)) {
    return serviceAreaFallbackZone();
  }
  return null;
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
