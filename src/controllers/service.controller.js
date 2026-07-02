const asyncHandler = require("express-async-handler");
const Service = require("../models/Service");
const { isMongoObjectId } = require("../lib/ids");
const { serializeService } = require("../lib/serialize");

const list = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const filter = { active: true };
  if (category) filter.categories = category;
  const services = await Service.find(filter).sort({ durationMin: 1 });
  res.json(services.map(serializeService));
});

const listAll = asyncHandler(async (_req, res) => {
  const services = await Service.find().sort({ createdAt: -1 });
  res.json(services.map(serializeService));
});

const get = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const svc = isMongoObjectId(id)
    ? await Service.findById(id)
    : await Service.findOne({ slug: id });
  if (!svc) return res.status(404).json({ error: "not_found" });
  res.json(serializeService(svc));
});

const reviews = asyncHandler(async (_req, res) => {
  res.json({ average: 4.8, count: 0, reviews: [] });
});

const create = asyncHandler(async (req, res) => {
  const svc = await Service.create(req.body);
  res.status(201).json(serializeService(svc));
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const svc = isMongoObjectId(id)
    ? await Service.findByIdAndUpdate(id, req.body, { new: true })
    : await Service.findOneAndUpdate({ slug: id }, req.body, { new: true });
  if (!svc) return res.status(404).json({ error: "not_found" });
  res.json(serializeService(svc));
});

const remove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const svc = isMongoObjectId(id)
    ? await Service.findByIdAndUpdate(id, { active: false }, { new: true })
    : await Service.findOneAndUpdate({ slug: id }, { active: false }, { new: true });
  if (!svc) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

module.exports = { list, listAll, get, reviews, create, update, remove };
