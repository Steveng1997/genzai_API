const router = require("express").Router();
const auth = require("../controllers/authController");

router.get("/profile", auth.getProfile);
router.post("/login", auth.login);
router.post("/complete-profile", auth.completeProfile);

module.exports = router;
