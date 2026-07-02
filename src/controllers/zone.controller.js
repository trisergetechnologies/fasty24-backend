const asyncHandler = require("express-async-handler");
const Zone = require("../models/Zone");
const geo = require("../services/geo");

/**
 * GET /zone/check?lat=28.6&lng=77.2
 * Returns whether the given coordinate falls inside an active service zone.
 */
const checkZone = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat_lng_required" });
  }

  const cell = geo.toCell(lat, lng);
  const zone = await Zone.findOne({ h3Cells: cell, active: true }).lean();

  if (zone) {
    return res.json({ inZone: true, zoneName: zone.name, zoneSlug: zone.slug });
  }

  return res.json({ inZone: false, zoneName: null, zoneSlug: null });
});

module.exports = { checkZone };
