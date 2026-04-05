const router = require("express").Router();
const vapi = require("../controllers/vapiController");

router.post("/webhook", vapi.handleWebhook);

module.exports = router;