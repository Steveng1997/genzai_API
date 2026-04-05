const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

// BLOQUE DE DEPURACIÓN (Revisa tu consola al iniciar)
console.log("Verificando aiController...");
console.log("setupAssistant:", typeof aiController.setupAssistant); // Debería decir 'function'
console.log("askRiley:", typeof aiController.askRiley); // Debería decir 'function'

if (!aiController.setupAssistant || !aiController.askRiley) {
  throw new Error(
    "ERROR CRÍTICO: Una o más funciones del controlador son UNDEFINED. Revisa src/controllers/aiController.js",
  );
}

// DEFINICIÓN DE RUTAS
router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);
router.post("/ask", aiController.askRiley);

module.exports = router;
