const asyncHandler = require("express-async-handler");
const slotsService = require("../services/slots");

const list = asyncHandler(async (req, res) => {
  const { serviceId, date, lat, lng } = req.query;
  try {
    const data = await slotsService.getAvailableSlots({
      serviceId,
      date,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || "server_error" });
  }
});

module.exports = { list };
