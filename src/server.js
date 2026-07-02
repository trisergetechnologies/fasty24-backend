const http = require("http");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const env = require("./config/env");
const { connectDB } = require("./config/db");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/error");
const { setupSocket } = require("./realtime/socket");

async function main() {
  await connectDB();

  const app = express();
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.use("/api/v1", routes);
  app.use(notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = setupSocket(server, env.CORS_ORIGINS);
  app.set("io", io);

  server.listen(env.PORT, () => {
    console.log(`[fasty24] http://localhost:${env.PORT}`);
    console.log(`[fasty24] dispatch_radius=${env.DISPATCH_RADIUS_METERS}m h3=${env.H3_RESOLUTION}`);
  });
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
