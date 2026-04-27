const router = require("express").Router();
const biz = require("../controllers/businessController");

router.post("/confirm-payment", biz.processPayment);
router.get("/payments/:tenantId", biz.getPayments);
router.get("/goals/:tenantId", biz.getGoals);
router.post("/goals", biz.upsertGoal);

module.exports = router;
