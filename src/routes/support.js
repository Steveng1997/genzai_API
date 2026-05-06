const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");

router.post("/save", supportController.saveSupportQuery);
router.get("/all", supportController.getAllSupportTickets);

module.exports = router;