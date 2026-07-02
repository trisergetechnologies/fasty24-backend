const mongoose = require("mongoose");
const env = require("./env");

async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`[db] connected: ${env.MONGO_URI}`);
}

module.exports = { connectDB };
