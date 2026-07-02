const connectedExperts = new Map();

function trackExpertConnection(expertId, socketId) {
  const id = expertId.toString();
  if (!connectedExperts.has(id)) connectedExperts.set(id, new Set());
  connectedExperts.get(id).add(socketId);
}

function untrackExpertConnection(expertId, socketId) {
  const id = expertId.toString();
  const set = connectedExperts.get(id);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) connectedExperts.delete(id);
}

function isExpertConnected(expertId) {
  const set = connectedExperts.get(expertId.toString());
  return !!set && set.size > 0;
}

module.exports = { trackExpertConnection, untrackExpertConnection, isExpertConnected };
