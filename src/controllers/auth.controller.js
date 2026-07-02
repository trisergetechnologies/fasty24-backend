const asyncHandler = require("express-async-handler");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const Expert = require("../models/Expert");
const Otp = require("../models/Otp");
const { signToken, verifyToken } = require("../middleware/auth");
const env = require("../config/env");
const sms = require("../services/sms");
const { serializeUser, serializeExpert } = require("../lib/serialize");
const { isProfileComplete } = require("../lib/profile");
const { loadExpertFromAuth } = require("../lib/expertAuth");

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID || "");

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (String(phone || "").startsWith("+")) return String(phone).trim();
  return phone;
}

const requestOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { role } = req.body;
  if (!phone || !["customer", "expert"].includes(role)) {
    return res.status(400).json({ error: "phone_and_role_required" });
  }
  if (env.DEV_BYPASS_OTP) {
    return res.json({
      ok: true,
      devCode: "000000",
      message: "DEV_BYPASS_OTP=true — use 000000 on verify.",
    });
  }
  const code = genCode();
  await Otp.create({ phone, code, role, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  try {
    await sms.sendOtp(phone, code);
  } catch (err) {
    console.warn("[auth] SMS failed:", err.message);
  }
  res.json({ ok: true });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { code, role, name } = req.body;
  if (!phone || !code || !role) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (!env.DEV_BYPASS_OTP) {
    const otp = await Otp.findOne({ phone, role, consumed: false }).sort({ createdAt: -1 });
    if (!otp || otp.code !== code || otp.expiresAt < new Date()) {
      return res.status(400).json({ error: "invalid_or_expired_otp" });
    }
    otp.consumed = true;
    await otp.save();
  }
  if (role === "customer") {
    const existing = await User.findOne({ phone });
    if (!existing || !isProfileComplete(existing)) {
      if (env.DEV_BYPASS_OTP) {
        const principal = await User.findOneAndUpdate(
          { phone },
          {
            phone,
            name: "Demo User",
            gender: "prefer_not_to_say",
            dateOfBirth: new Date("1990-01-01"),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const token = signToken({ sub: principal._id.toString(), role: "customer" });
        return res.json({
          token,
          role: "customer",
          principal: serializeUser(principal),
          needsProfile: false,
          isNew: !existing,
        });
      }
      const registrationToken = signToken(
        { phone, role: "registration", sub: phone },
        { expiresIn: "15m" }
      );
      return res.json({
        needsProfile: true,
        isNew: !existing,
        phone,
        registrationToken,
      });
    }
    const token = signToken({ sub: existing._id.toString(), role: "customer" });
    return res.json({
      token,
      role: "customer",
      principal: serializeUser(existing),
      needsProfile: false,
      isNew: false,
    });
  }
  const principal = await Expert.findOneAndUpdate(
    { phone },
    {
      $setOnInsert: {
        phone,
        name: name || "New Expert",
        skills: ["instant_maid", "ac_service"],
      },
    },
    { upsert: true, new: true }
  );
  const token = signToken({
    sub: principal._id.toString(),
    role: "expert",
    phone: principal.phone,
  });
  return res.json({
    token,
    role: "expert",
    principal: await serializeExpert(principal),
    needsProfile: false,
  });
});

const completeProfile = asyncHandler(async (req, res) => {
  const { name, gender, dateOfBirth } = req.body;
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token) return res.status(401).json({ error: "missing_token" });
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
  if (decoded.role !== "registration" || !decoded.phone) {
    return res.status(403).json({ error: "invalid_registration_token" });
  }
  if (!name?.trim() || !gender || !dateOfBirth) {
    return res.status(400).json({ error: "profile_fields_required" });
  }
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return res.status(400).json({ error: "invalid_date_of_birth" });
  }
  const principal = await User.findOneAndUpdate(
    { phone: decoded.phone },
    { phone: decoded.phone, name: name.trim(), gender, dateOfBirth: dob },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const authToken = signToken({ sub: principal._id.toString(), role: "customer" });
  res.json({
    token: authToken,
    role: "customer",
    principal: serializeUser(principal),
    needsProfile: false,
    isNew: true,
  });
});

const me = asyncHandler(async (req, res) => {
  const principal =
    req.auth.role === "customer"
      ? await User.findById(req.auth.sub)
      : await loadExpertFromAuth(req.auth);
  if (!principal) return res.status(404).json({ error: "not_found" });
  const serialized =
    req.auth.role === "customer"
      ? serializeUser(principal)
      : await serializeExpert(principal);
  res.json({
    role: req.auth.role,
    principal: serialized,
    needsProfile: req.auth.role === "customer" ? !isProfileComplete(principal) : false,
  });
});

const updatePushToken = asyncHandler(async (req, res) => {
  const { pushToken } = req.body;
  if (req.auth.role === "customer") {
    await User.findByIdAndUpdate(req.auth.sub, { pushToken });
  } else {
    const expert = await loadExpertFromAuth(req.auth);
    if (expert) await Expert.findByIdAndUpdate(expert._id, { pushToken });
  }
  res.json({ ok: true });
});

const registerEmail = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email_password_name_required" });
  }
  const emailLower = email.toLowerCase().trim();
  const existing = await User.findOne({ email: emailLower });
  if (existing) {
    return res.status(409).json({ error: "email_already_registered" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: emailLower,
    passwordHash,
    name: name.trim(),
    authMethod: "email",
  });
  const token = signToken({ sub: user._id.toString(), role: "customer" });
  res.status(201).json({
    token,
    role: "customer",
    principal: serializeUser(user),
    needsProfile: !isProfileComplete(user),
    isNew: true,
  });
});

const loginEmail = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email_and_password_required" });
  }
  const emailLower = email.toLowerCase().trim();
  const user = await User.findOne({ email: emailLower });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = signToken({ sub: user._id.toString(), role: "customer" });
  res.json({
    token,
    role: "customer",
    principal: serializeUser(user),
    needsProfile: !isProfileComplete(user),
    isNew: false,
  });
});

const googleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: "id_token_required" });
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "invalid_google_token" });
  }
  const { sub: googleId, email, name, picture } = payload;
  let user = await User.findOne({ googleId });
  if (!user && email) {
    user = await User.findOne({ email: email.toLowerCase() });
  }
  const isNew = !user;
  if (!user) {
    user = await User.create({
      googleId,
      ...(email ? { email: email.toLowerCase() } : {}),
      name: name || "",
      authMethod: "google",
    });
  } else if (!user.googleId) {
    user.googleId = googleId;
    user.authMethod = "google";
    await user.save();
  }
  const token = signToken({ sub: user._id.toString(), role: "customer" });
  res.json({
    token,
    role: "customer",
    principal: serializeUser(user),
    needsProfile: !isProfileComplete(user),
    isNew,
  });
});

module.exports = {
  requestOtp,
  verifyOtp,
  completeProfile,
  me,
  updatePushToken,
  registerEmail,
  loginEmail,
  googleAuth,
};
