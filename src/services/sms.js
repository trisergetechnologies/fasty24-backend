const env = require("../config/env");

async function sendOtp(phone, code, context = "login") {
  const label = context === "login" ? "login OTP" : `${context} OTP`;
  if (!env.MSG91_API_KEY) {
    console.log(`[sms] ${label} ${code} -> ${phone}`);
    return;
  }
  // MSG91 integration placeholder — logs until credentials are wired
  console.log(`[sms] would send ${label} ${code} to ${phone}`);
}

module.exports = { sendOtp };
