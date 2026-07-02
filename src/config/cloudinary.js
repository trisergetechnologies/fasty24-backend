const { v2: cloudinary } = require("cloudinary");
const env = require("./env");

let configured = false;

function isConfigured() {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  );
}

function getCloudinary() {
  if (!isConfigured()) return null;
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

function uploadBuffer(buffer, options = {}) {
  const client = getCloudinary();
  if (!client) {
    return Promise.reject(new Error("cloudinary_not_configured"));
  }
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      { folder: env.CLOUDINARY_FOLDER, resource_type: "image", ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

module.exports = { getCloudinary, isConfigured, uploadBuffer };
