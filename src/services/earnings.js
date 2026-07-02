const Booking = require("../models/Booking");

const COMMISSION_RATE = 0.75;

async function getDashboard(expertId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completed = await Booking.countDocuments({
    expert: expertId,
    status: "completed",
    "timeline.completedAt": { $gte: today },
  });
  const earnings = await Booking.aggregate([
    {
      $match: {
        expert: expertId,
        status: "completed",
        "timeline.completedAt": { $gte: today },
      },
    },
    { $group: { _id: null, total: { $sum: "$expertEarning" } } },
  ]);
  return {
    todayJobs: completed,
    todayEarnings: earnings[0]?.total || 0,
    commissionRate: COMMISSION_RATE,
  };
}

async function getEarnings(expertId, period = "today") {
  const since = new Date();
  if (period === "week") since.setDate(since.getDate() - 7);
  else since.setHours(0, 0, 0, 0);
  const rows = await Booking.find({
    expert: expertId,
    status: "completed",
    "timeline.completedAt": { $gte: since },
  }).select("expertEarning pricing timeline");
  const total = rows.reduce((s, b) => s + (b.expertEarning || 0), 0);
  return { period, total, jobs: rows.length };
}

module.exports = { COMMISSION_RATE, getDashboard, getEarnings };
