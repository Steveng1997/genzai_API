const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");

router.post("/save", supportController.saveSupportQuery);
router.get("/all", supportController.getAllSupportTickets);
router.get("/by-plan", supportController.getSupportByPlan);

module.exports = router;