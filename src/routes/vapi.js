const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");
const reportController = require("../controllers/reportController");

router.post("/riley-create", taskController.handleRileyTool);
router.post("/webhook", reportController.handleVapiWebhook);

module.exports = router;