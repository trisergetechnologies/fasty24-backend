const asyncHandler = require("express-async-handler");
const Category = require("../models/Category");
const Service = require("../models/Service");
const { isMongoObjectId } = require("../lib/ids");
const { serializeCategory, serializeService } = require("../lib/serialize");

const list = asyncHandler(async (_req, res) => {
  const categories = await Category.find({ active: true }).sort({ sortOrder: 1 }).lean();
  const services = await Service.find({ active: true }).sort({ durationMin: 1 }).lean();
  const out = categories.map((cat) => ({
    ...serializeCategory(cat),
    services: services
      .filter((s) => s.categories.includes(cat.slug))
      .map(serializeService),
  }));
  res.json(out);
});

const listAll = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1 });
  res.json(categories.map(serializeCategory));
});

const create = asyncHandler(async (req, res) => {
  const cat = await Category.create(req.body);
  res.status(201).json(serializeCategory(cat));
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cat = isMongoObjectId(id)
    ? await Category.findByIdAndUpdate(id, req.body, { new: true })
    : await Category.findOneAndUpdate({ slug: id }, req.body, { new: true });
  if (!cat) return res.status(404).json({ error: "not_found" });
  res.json(serializeCategory(cat));
});

module.exports = { list, listAll, create, update };
