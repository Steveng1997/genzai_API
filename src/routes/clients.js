const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");

router.post("/upload-manual", clientController.uploadManual);

module.exports = router;
