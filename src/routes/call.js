const router = require("express").Router();
const call = require("../controllers/callController");

router.post("/make-smart-call", call.makeSmartCall);

module.exports = router;