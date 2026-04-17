const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const aiController = require("../controllers/aiController");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "/tmp");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  "/setup-assistant",
  upload.array("files"),
  aiController.setupAssistant,
);

router.post("/update-prompt", aiController.updatePrompt);

module.exports = router;
