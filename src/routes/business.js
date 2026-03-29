const router = require("express").Router();
const biz = require("../controllers/businessController");

router.post("/confirm-payment", biz.confirmPayment);

module.exports = router;
