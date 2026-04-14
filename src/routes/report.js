const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");

router.post("/webhook", reportController.handleVapiWebhook);

module.exports = router;