const asyncHandler = require("express-async-handler");
const Zone = require("../models/Zone");
const geo = require("../services/geo");
const {
  isWithinConfiguredServiceArea,
  serviceAreaFallbackZone,
} = require("../services/pricing");

/**
 * GET /zone/check?lat=28.65&lng=77.34
 * Returns whether the given coordinate falls inside an active service zone
 * (H3 polygon) or the configured launch radius (Vaishali ~7 km).
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

  if (isWithinConfiguredServiceArea(lat, lng)) {
    const fallback = serviceAreaFallbackZone();
    return res.json({
      inZone: true,
      zoneName: fallback.name,
      zoneSlug: fallback.slug,
    });
  }

  return res.json({ inZone: false, zoneName: null, zoneSlug: null });
});

module.exports = { checkZone };
