const express = require("express");
const router = express.Router();
const multer = require("multer");
const aiController = require("../controllers/aiController");

// Configuración de almacenamiento en memoria (necesario para enviar a OpenAI sin guardar localmente)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // Limite de 50MB
    files: 10, // Limite de hasta 10 archivos por subida
  },
});

// --- RUTAS ---

// Obtener configuración actual
router.get("/get-config/:tenantId", aiController.getConfig);

/**
 * CORRECCIÓN: setup-assistant
 * El nombre 'files' debe ser exactamente igual al que envías en Flutter
 * mediante request.files.add(http.MultipartFile.fromBytes('files', ...))
 */
router.post(
  "/setup-assistant",
  upload.array("files"), // Captura el array de archivos
  aiController.setupAssistant,
);

// Actualizar el prompt (crear o reemplazar)
router.post("/update-prompt", aiController.updatePrompt);

// Editar prompt existente (específicamente para arrays)
router.post("/edit-prompt", aiController.editPrompt);

module.exports = router;
