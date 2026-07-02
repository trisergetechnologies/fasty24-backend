const env = require("../config/env");

async function sendOtp(phone, code) {
  if (!env.MSG91_API_KEY) {
    console.log(`[sms] OTP ${code} -> ${phone}`);
    return;
  }
  console.log(`[sms] would send OTP to ${phone}`);
}

module.exports = { sendOtp };
