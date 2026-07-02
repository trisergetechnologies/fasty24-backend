function isProfileComplete(user) {
  if (!user) return false;
  const name = (user.name || "").trim();
  const gender = (user.gender || "").trim();
  const dob = user.dateOfBirth;
  return Boolean(name && gender && dob);
}

module.exports = { isProfileComplete };
