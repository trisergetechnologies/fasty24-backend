const { Server } = require("socket.io");
const { verifyToken } = require("../middleware/auth");
const Expert = require("../models/Expert");
const dispatcher = require("../services/dispatcher");
const geo = require("../services/geo");
const { loadExpertFromAuth } = require("../lib/expertAuth");
const { trackExpertConnection, untrackExpertConnection } = require("./connections");

function setupSocket(server, corsOrigins) {
  const io = new Server(server, {
    cors: { origin: corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("unauthorized"));
      const decoded = verifyToken(token);
      socket.user = decoded;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    let { sub, role } = socket.user;
    if (role === "expert") {
      const expert = await loadExpertFromAuth(socket.user);
      if (!expert) {
        socket.disconnect(true);
        return;
      }
      sub = expert._id.toString();
      socket.user = { ...socket.user, sub };
      trackExpertConnection(sub, socket.id);
    }
    socket.join(`${role}:${sub}`);

    socket.on("booking:subscribe", ({ bookingId }) => {
      if (bookingId) socket.join(`booking:${bookingId}`);
    });

    socket.on("booking:unsubscribe", ({ bookingId }) => {
      if (bookingId) socket.leave(`booking:${bookingId}`);
    });

    socket.on("dispatch:respond", async ({ bookingId, accepted }) => {
      if (role !== "expert") return;
      await dispatcher.handleExpertResponse(io, bookingId, sub, !!accepted);
    });

    socket.on("expert:location", async ({ lat, lng, bookingId }) => {
      if (role !== "expert") return;
      if (typeof lat !== "number" || typeof lng !== "number") return;
      try {
        await Expert.updateOne(
          { _id: sub },
          {
            lastLocation: { lat, lng, updatedAt: new Date() },
            h3Index: geo.toCell(lat, lng),
          }
        );
      } catch (err) {
        console.warn("[socket] location write failed", err.message);
      }
      if (bookingId) {
        io.to(`booking:${bookingId}`).emit("booking:expert_location", {
          lat,
          lng,
          at: Date.now(),
        });
      }
    });

    socket.on("disconnect", () => {
      if (role === "expert") untrackExpertConnection(sub, socket.id);
    });
  });

  return io;
}

module.exports = { setupSocket };
