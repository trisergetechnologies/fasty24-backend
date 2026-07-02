const asyncHandler = require("express-async-handler");
const multer = require("multer");
const { uploadBuffer, isConfigured } = require("../config/cloudinary");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("only_images_allowed"));
    }
    cb(null, true);
  },
});

const single = upload.single("file");
const multiple = upload.array("files", 12);

const uploadSingle = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "cloudinary_not_configured" });
  }
  if (!req.file) return res.status(400).json({ error: "no_file" });
  const result = await uploadBuffer(req.file.buffer);
  res.status(201).json({ url: result.secure_url, publicId: result.public_id });
});

const uploadMultiple = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "cloudinary_not_configured" });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "no_files" });
  }
  const results = await Promise.all(req.files.map((f) => uploadBuffer(f.buffer)));
  res.status(201).json({
    images: results.map((r) => ({ url: r.secure_url, publicId: r.public_id })),
  });
});

module.exports = { single, multiple, uploadSingle, uploadMultiple };
