const router = require("express").Router();
const biz = require("../controllers/businessController");

router.post("/confirm-payment", biz.confirmPayment);
router.get("/goals", biz.getGoals);
router.post("/goals", biz.upsertGoal);

module.exports = router;
