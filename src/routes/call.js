const express = require("express");
const router = express.Router();
const callController = require("../controllers/callController");

router.post("/make-smart-call", callController.makeSmartCall);
router.post("/webhook", callController.vapiWebhook);

module.exports = router;
