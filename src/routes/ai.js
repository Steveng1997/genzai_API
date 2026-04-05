const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const multer = require("multer");

// Configuración de almacenamiento temporal para archivos (PDF, Excel, JPG)
const upload = multer({ dest: "uploads/" });

// 'files' es el nombre que usamos en el MultipartRequest de Flutter
router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

module.exports = router;
