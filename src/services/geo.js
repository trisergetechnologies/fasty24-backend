const h3 = require("h3-js");
const env = require("../config/env");

const HEX_EDGE_KM = { 6: 3.229, 7: 1.22, 8: 0.461, 9: 0.174, 10: 0.066 };

function toCell(lat, lng, res = env.H3_RESOLUTION) {
  return h3.latLngToCell(lat, lng, res);
}

function ringCells(lat, lng, k, res = env.H3_RESOLUTION) {
  const origin = h3.latLngToCell(lat, lng, res);
  return h3.gridDisk(origin, k);
}

function kForRadiusMeters(radiusMeters, res = env.H3_RESOLUTION) {
  const radiusKm = radiusMeters / 1000;
  const edge = HEX_EDGE_KM[res] ?? 0.174;
  return Math.max(1, Math.ceil(radiusKm / (edge * Math.sqrt(3))));
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distanceMeters(a, b) {
  return haversineKm(a, b) * 1000;
}

function etaMinutes(distanceKm, speedKmph = env.EXPERT_AVG_SPEED_KMPH) {
  if (speedKmph <= 0) return Infinity;
  return (distanceKm / speedKmph) * 60;
}

module.exports = {
  toCell,
  ringCells,
  kForRadiusMeters,
  haversineKm,
  distanceMeters,
  etaMinutes,
};
