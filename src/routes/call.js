const express = require("express");
const router = express.Router();
const callController = require("../controllers/callController");

if (!callController.makeSmartCall) {
  console.error(
    "ERROR: La función makeSmartCall no está definida en el controlador.",
  );
}

router.post("/make-smart-call", callController.makeSmartCall);

module.exports = router;
