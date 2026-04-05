const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");

router.get("/", taskController.getTasks);
router.patch("/update-status", taskController.completeTask);
router.post("/webhook-vapi", taskController.handleVapiWebhook);

module.exports = router;
