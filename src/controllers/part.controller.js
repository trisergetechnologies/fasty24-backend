const asyncHandler = require("express-async-handler");
const Part = require("../models/Part");
const { findByPublicId } = require("../lib/ids");
const { serializePart } = require("../lib/serializeCommerce");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(base, ignoreId = null) {
  const root = slugify(base) || `part-${Date.now()}`;
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Part.exists({ slug: candidate, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expert/customer facing catalog — only approved, active parts. */
const list = asyncHandler(async (req, res) => {
  const { category, serviceSlug, q, kind } = req.query;
  const filter = { active: true, verificationStatus: "approved" };
  if (category) filter.categories = category;
  if (serviceSlug) filter.serviceSlugs = serviceSlug;
  if (kind) filter.kind = kind;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).trim()), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }];
  }
  const parts = await Part.find(filter).sort({ usageCount: -1, name: 1 }).limit(200).lean();
  res.json(parts.map((p) => serializePart(p)));
});

const listAll = asyncHandler(async (req, res) => {
  const { category, verificationStatus, source, q, active } = req.query;
  const filter = {};
  if (category) filter.categories = category;
  if (verificationStatus) filter.verificationStatus = verificationStatus;
  if (source) filter.source = source;
  if (active === "true") filter.active = true;
  if (active === "false") filter.active = false;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).trim()), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }];
  }
  const parts = await Part.find(filter)
    .populate("createdByExpert", "name publicId")
    .sort({ verificationStatus: 1, updatedAt: -1 })
    .limit(500);
  res.json(parts.map((p) => serializePart(p, { includeCost: true })));
});

function readPartBody(body) {
  const out = {};
  const passthrough = [
    "name",
    "sku",
    "brand",
    "description",
    "imageUrl",
    "categories",
    "serviceSlugs",
    "kind",
    "kitItems",
    "unit",
    "adminNote",
  ];
  passthrough.forEach((key) => {
    if (body[key] !== undefined) out[key] = body[key];
  });
  if (body.price !== undefined) out.price = Math.max(0, Number(body.price) || 0);
  if (body.costPrice !== undefined) out.costPrice = Math.max(0, Number(body.costPrice) || 0);
  if (body.taxPercent !== undefined) {
    out.taxPercent = body.taxPercent === null || body.taxPercent === "" ? null : Number(body.taxPercent);
  }
  if (body.active !== undefined) out.active = !!body.active;
  return out;
}

const create = asyncHandler(async (req, res) => {
  const data = readPartBody(req.body);
  if (!data.name) return res.status(400).json({ error: "name_required" });
  if (data.price === undefined) return res.status(400).json({ error: "price_required" });
  data.slug = await uniqueSlug(req.body.slug || data.name);
  data.source = "catalog";
  data.verificationStatus = "approved";
  const part = await Part.create(data);
  res.status(201).json(serializePart(part, { includeCost: true }));
});

const update = asyncHandler(async (req, res) => {
  const part = await findByPublicId(Part, req.params.id);
  if (!part) return res.status(404).json({ error: "not_found" });
  const data = readPartBody(req.body);
  if (req.body.slug && req.body.slug !== part.slug) {
    data.slug = await uniqueSlug(req.body.slug, part._id);
  }
  Object.assign(part, data);
  await part.save();
  res.json(serializePart(part, { includeCost: true }));
});

const remove = asyncHandler(async (req, res) => {
  const part = await findByPublicId(Part, req.params.id);
  if (!part) return res.status(404).json({ error: "not_found" });
  await part.deleteOne();
  res.json({ ok: true });
});

/** Admin approves an expert-submitted part, optionally correcting the price first. */
const approve = asyncHandler(async (req, res) => {
  const part = await findByPublicId(Part, req.params.id);
  if (!part) return res.status(404).json({ error: "not_found" });
  const data = readPartBody(req.body);
  Object.assign(part, data);
  part.verificationStatus = "approved";
  part.active = true;
  await part.save();
  res.json(serializePart(part, { includeCost: true }));
});

const reject = asyncHandler(async (req, res) => {
  const part = await findByPublicId(Part, req.params.id);
  if (!part) return res.status(404).json({ error: "not_found" });
  part.verificationStatus = "rejected";
  part.active = false;
  part.adminNote = req.body?.note || part.adminNote;
  await part.save();
  res.json(serializePart(part, { includeCost: true }));
});

module.exports = { list, listAll, create, update, remove, approve, reject, uniqueSlug, slugify };
