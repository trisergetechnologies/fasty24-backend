const asyncHandler = require("express-async-handler");
const User = require("../models/User");

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ["name", "gender", "dateOfBirth", "email"];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  const user = await User.findByIdAndUpdate(req.auth.sub, patch, { new: true });
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth.sub);
  if (!user) return res.status(404).json({ error: "not_found" });
  const addr = { ...req.body, isDefault: user.addresses.length === 0 };
  user.addresses.push(addr);
  await user.save();
  res.status(201).json({ ok: true });
});

const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth.sub);
  if (!user) return res.status(404).json({ error: "not_found" });
  const addr = user.addresses.id(req.params.addressId);
  if (!addr) return res.status(404).json({ error: "not_found" });
  Object.assign(addr, req.body);
  await user.save();
  res.json({ ok: true });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth.sub);
  if (!user) return res.status(404).json({ error: "not_found" });
  user.addresses.pull(req.params.addressId);
  await user.save();
  res.json({ ok: true });
});

const setDefaultAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth.sub);
  if (!user) return res.status(404).json({ error: "not_found" });
  for (const a of user.addresses) {
    a.isDefault = a._id.toString() === req.params.addressId;
  }
  await user.save();
  res.json({ ok: true });
});

module.exports = {
  updateProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
