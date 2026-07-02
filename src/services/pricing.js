const Zone = require("../models/Zone");
const Service = require("../models/Service");
const geo = require("./geo");

async function resolveZone(lat, lng) {
  const cell = geo.toCell(lat, lng);
  return Zone.findOne({ h3Cells: cell, active: true }).lean();
}

async function getServicePrice(service, _zone) {
  return service.price;
}

async function priceServices(services) {
  return services.map((s) => ({ ...s.toObject(), price: s.price }));
}

module.exports = { resolveZone, getServicePrice, priceServices };
