const dispatcher = require("./dispatcher");

const scheduledTimers = new Map();

function scheduleDispatch(io, bookingId, runAt) {
  const delay = new Date(runAt).getTime() - Date.now();
  const key = bookingId.toString();
  if (scheduledTimers.has(key)) {
    clearTimeout(scheduledTimers.get(key));
  }
  if (delay <= 0) {
    return dispatcher.runDispatch(io, bookingId);
  }
  const timer = setTimeout(() => {
    scheduledTimers.delete(key);
    dispatcher.runDispatch(io, bookingId);
  }, Math.min(delay, 2147483647));
  scheduledTimers.set(key, timer);
}

function cancelScheduledDispatch(bookingId) {
  const key = bookingId.toString();
  const timer = scheduledTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    scheduledTimers.delete(key);
  }
}

module.exports = { scheduleDispatch, cancelScheduledDispatch };
