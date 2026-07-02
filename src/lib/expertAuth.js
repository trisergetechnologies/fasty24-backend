const Expert = require("../models/Expert");
const { findByPublicId } = require("./ids");

async function loadExpertFromAuth(auth) {
  if (!auth) return null;
  if (auth.sub) {
    const byId = await findByPublicId(Expert, auth.sub);
    if (byId) return byId;
  }
  if (auth.phone) {
    return Expert.findOne({ phone: auth.phone });
  }
  return null;
}

module.exports = { loadExpertFromAuth };
