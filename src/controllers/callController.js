const express = require("express");
const router = express.Router();
const callController = require("../controllers/callController");

router.post("/make-smart-call", callController.makeSmartCall);

module.exports = router;
