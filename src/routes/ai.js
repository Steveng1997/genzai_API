const router = require("express").Router();
const ai = require("../controllers/aiController");
const multer = require("multer")({ dest: "/tmp/" });

router.post("/setup-assistant", multer.array("files"), ai.setupAssistant);

module.exports = router;