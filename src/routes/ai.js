const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const multer = require("multer");

// Configuración de almacenamiento temporal
const upload = multer({ dest: "uploads/" });

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

module.exports = router;