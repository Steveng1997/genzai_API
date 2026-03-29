const router = require("express").Router();
const web = require("../controllers/webhookController");

router.post("/vapi", web.vapiWebhook);

module.exports = router;
