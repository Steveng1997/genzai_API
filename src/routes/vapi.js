const express = require("express");
const router = express.Router();
const vapiController = require("../controllers/vapiController");

router.post("/webhook", vapiController.handleWebhook);

module.exports = router;
