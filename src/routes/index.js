const router = require("express").Router();
const auth = require("../controllers/auth.controller");
const services = require("../controllers/service.controller");
const categories = require("../controllers/category.controller");
const bookings = require("../controllers/booking.controller");
const experts = require("../controllers/expert.controller");
const customer = require("../controllers/customer.controller");
const admin = require("../controllers/admin.controller");
const slots = require("../controllers/slots.controller");
const uploads = require("../controllers/upload.controller");
const zones = require("../controllers/zone.controller");
const parts = require("../controllers/part.controller");
const estimates = require("../controllers/estimate.controller");
const payments = require("../controllers/payment.controller");
const { requireAuth } = require("../middleware/auth");

// Public: signature-verified, must stay unauthenticated for Razorpay to reach it
router.post("/payments/webhook/razorpay", payments.webhook);

router.post("/auth/request-otp", auth.requestOtp);
router.post("/auth/verify-otp", auth.verifyOtp);
router.post("/auth/complete-profile", auth.completeProfile);
router.post("/auth/login-email", auth.loginEmail);
router.post("/auth/register-email", auth.registerEmail);
router.get("/services", services.list);
router.get("/services/:id/reviews", services.reviews);
router.get("/services/:id", services.get);
router.get("/categories", categories.list);
router.get("/slots", slots.list);
router.get("/zone/check", zones.checkZone);

router.get("/me", requireAuth(), auth.me);
router.patch("/me/profile", requireAuth("customer"), customer.updateProfile);
router.post("/me/push-token", requireAuth(), auth.updatePushToken);
router.post("/me/addresses", requireAuth("customer"), customer.addAddress);
router.patch("/me/addresses/:addressId", requireAuth("customer"), customer.updateAddress);
router.delete("/me/addresses/:addressId", requireAuth("customer"), customer.deleteAddress);
router.post("/me/addresses/:addressId/default", requireAuth("customer"), customer.setDefaultAddress);

router.post("/bookings", requireAuth("customer"), bookings.create);
router.get("/bookings", requireAuth(), bookings.list);
router.get("/bookings/:id", requireAuth(), bookings.get);
router.post("/bookings/:id/cancel", requireAuth("customer"), bookings.cancel);
router.post("/bookings/:id/add-on", requireAuth(), bookings.addAddOn);
router.post("/bookings/:id/addon/suggest", requireAuth("expert"), bookings.suggestAddOn);
router.get("/bookings/:id/addons/available", requireAuth(), bookings.availableAddOns);
router.post("/bookings/:id/payment", requireAuth("customer"), bookings.confirmPayment);
router.post("/bookings/:id/payment/link", requireAuth("customer"), payments.createBookingLink);
router.post("/bookings/:id/payment/order", requireAuth("customer"), payments.createBookingOrder);
router.post("/bookings/:id/payment/verify", requireAuth("customer"), payments.verifyBookingOrder);
router.get("/bookings/:id/payment/status", requireAuth("customer"), payments.bookingPaymentStatus);
router.post("/bookings/:id/rate", requireAuth("customer"), bookings.rate);

// Parts catalog — approved + active entries, readable by any signed-in role
router.get("/parts", requireAuth(), parts.list);

// Estimates
router.post("/bookings/:id/estimates", requireAuth("expert"), estimates.create);
router.get("/bookings/:id/estimates", requireAuth(), estimates.listForBooking);
router.get("/estimates/:id", requireAuth(), estimates.get);
router.patch("/estimates/:id", requireAuth("expert"), estimates.update);
router.post("/estimates/:id/send", requireAuth("expert"), estimates.send);
router.post("/estimates/:id/cancel", requireAuth("expert"), estimates.cancel);
router.post("/estimates/:id/approve", requireAuth("customer"), estimates.approve);
router.post("/estimates/:id/reject", requireAuth("customer"), estimates.reject);
router.post("/estimates/:id/lines/:lineId/proof", requireAuth("expert"), estimates.addLineProof);
router.delete("/estimates/:id/lines/:lineId/proof", requireAuth("expert"), estimates.removeLineProof);

// Estimate settlement
router.post("/estimates/:id/payment/link", requireAuth("expert"), payments.createEstimateLink);
router.post("/estimates/:id/payment/cash", requireAuth("expert"), payments.markEstimateCash);
router.post("/estimates/:id/payment/checkout", requireAuth("customer"), payments.customerEstimateLink);
router.post("/estimates/:id/payment/order", requireAuth("customer"), payments.createEstimateOrder);
router.post("/estimates/:id/payment/verify", requireAuth("customer"), payments.verifyEstimateOrder);
router.get("/estimates/:id/payment/status", requireAuth(), payments.estimatePaymentStatus);

router.get("/expert/me", requireAuth("expert"), experts.me);
router.patch("/expert/me", requireAuth("expert"), experts.updateProfile);
router.post("/expert/online", requireAuth("expert"), experts.goOnline);
router.post("/expert/offline", requireAuth("expert"), experts.goOffline);
router.get("/expert/dashboard", requireAuth("expert"), experts.dashboard);
router.get("/expert/earnings", requireAuth("expert"), experts.earnings);
router.get("/expert/pending-offer", requireAuth("expert"), experts.pendingOffer);
router.post("/expert/offer/respond", requireAuth("expert"), experts.respondOffer);
router.post("/expert/kyc", requireAuth("expert"), experts.submitOnboarding);
router.post("/expert/training", requireAuth("expert"), experts.updateTraining);
router.post("/expert/uploads", requireAuth("expert"), uploads.single, uploads.uploadSingle);
router.post("/bookings/:id/en-route", requireAuth("expert"), bookings.expertEnRoute);
router.post("/bookings/:id/arrived", requireAuth("expert"), bookings.expertArrived);
router.post("/bookings/:id/start", requireAuth("expert"), bookings.expertStart);
router.post("/bookings/:id/complete", requireAuth("expert"), bookings.expertComplete);

router.post("/admin/login", admin.login);
router.get("/admin/bookings", requireAuth("admin"), admin.listBookings);
router.get("/admin/reviews", requireAuth("admin"), admin.listReviews);
router.get("/admin/services", requireAuth("admin"), services.listAll);
router.post("/admin/services", requireAuth("admin"), services.create);
router.patch("/admin/services/:id", requireAuth("admin"), services.update);
router.delete("/admin/services/:id", requireAuth("admin"), services.remove);
router.get("/admin/categories", requireAuth("admin"), categories.listAll);
router.post("/admin/categories", requireAuth("admin"), categories.create);
router.patch("/admin/categories/:id", requireAuth("admin"), categories.update);
router.get("/admin/experts", requireAuth("admin"), admin.listExperts);
router.get("/admin/experts/:id", requireAuth("admin"), admin.getExpert);
router.post("/admin/experts/:id/approve", requireAuth("admin"), admin.approveExpert);
router.post("/admin/experts/:id/reject", requireAuth("admin"), admin.rejectExpert);
router.get("/admin/parts", requireAuth("admin"), parts.listAll);
router.post("/admin/parts", requireAuth("admin"), parts.create);
router.patch("/admin/parts/:id", requireAuth("admin"), parts.update);
router.delete("/admin/parts/:id", requireAuth("admin"), parts.remove);
router.post("/admin/parts/:id/approve", requireAuth("admin"), parts.approve);
router.post("/admin/parts/:id/reject", requireAuth("admin"), parts.reject);
router.get("/admin/estimates", requireAuth("admin"), estimates.adminList);
router.get("/admin/payments", requireAuth("admin"), payments.adminList);
router.post("/admin/uploads", requireAuth("admin"), uploads.single, uploads.uploadSingle);
router.post("/admin/uploads/multiple", requireAuth("admin"), uploads.multiple, uploads.uploadMultiple);

module.exports = router;
