const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const callController = require("../controllers/callController");
const multer = require("multer");

const upload = multer({ dest: "uploads/" });

router.post(
  "/setup-assistant",
  upload.array("files", 20),
  aiController.setupAssistant,
);

router.post("/call", callController.makeSmartCall);

module.exports = router;
