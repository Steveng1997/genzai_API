const express = require("express");
const router = express.Router();
const multer = require("multer");
const aiController = require("../controllers/aiController");

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get("/get-config/:tenantId", aiController.getConfig);

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

router.post("/update-prompt", aiController.updatePrompt);
router.post("/edit-prompt", aiController.editPrompt);

module.exports = router;
