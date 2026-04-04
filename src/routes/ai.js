const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

router.post("/ask", aiController.askRiley);

module.exports = router;
