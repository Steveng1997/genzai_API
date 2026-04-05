const router = require("express").Router();
const ai = require("../controllers/aiController");

router.post("/setup-assistant", ai.setupAssistant);

module.exports = router;