const express = require("express");
const router = express.Router();
const callController = require("../controllers/callController");

if (!callController.makeSmartCall) {
  console.error(
    "CRÍTICO: callController.makeSmartCall es UNDEFINED. Revisa la exportación.",
  );
}

router.post("/make-smart-call", callController.makeSmartCall);

module.exports = router;
