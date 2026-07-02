const crypto = require("crypto");
const mongoose = require("mongoose");

function newPublicId() {
  return crypto.randomUUID();
}

function isMongoObjectId(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function publicIdPlugin(schema) {
  schema.add({
    publicId: {
      type: String,
      unique: true,
      index: true,
      default: newPublicId,
    },
  });
}

async function findByPublicId(Model, paramId, extraFilter = {}) {
  if (!paramId) return null;
  if (isMongoObjectId(paramId)) {
    return Model.findOne({ _id: paramId, ...extraFilter });
  }
  return Model.findOne({ publicId: paramId, ...extraFilter });
}

function bookingRoomId(booking) {
  if (!booking) return null;
  return booking.publicId || booking.toString?.();
}

module.exports = {
  newPublicId,
  isMongoObjectId,
  publicIdPlugin,
  findByPublicId,
  bookingRoomId,
};
