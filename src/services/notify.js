const env = require("../config/env");

async function expoPush(token, title, body, data = {}) {
  if (!token) return;
  try {
    if (env.EXPO_PUSH_ENABLED) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: token, sound: "default", title, body, data }),
      });
    } else {
      console.log("[notify]", title, body);
    }
  } catch (err) {
    console.warn("[notify] push failed", err.message);
  }
}

function emitToRoom(io, room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

module.exports = { expoPush, emitToRoom };
