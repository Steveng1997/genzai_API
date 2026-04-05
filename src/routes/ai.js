const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const multer = require("multer");

// Configuración de Multer
const upload = multer({ dest: "uploads/" });

if (!aiController.setupAssistant) {
  console.error(
    "ERROR: aiController.setupAssistant no está definido. Revisa la exportación.",
  );
}

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

router.post("/ask", aiController.askRiley);

module.exports = router;
