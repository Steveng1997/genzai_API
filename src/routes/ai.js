const express = require("express");
const router = express.Router();
const multer = require("multer");
const aiController = require("../controllers/aiController");

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

router.get("/get-config/:tenantId", aiController.getConfig);
router.get("/get-history/:tenantId", aiController.getChatHistory);

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

router.post("/ask-riley", aiController.askRiley);

router.post(
  "/analyze-product",
  upload.single("file"),
  aiController.analyzeProductImage,
);

module.exports = router;
