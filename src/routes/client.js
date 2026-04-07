const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");

router.get("/", clientController.getAllClients);
router.post("/save", clientController.saveClient);
router.delete("/delete/:phone", clientController.deleteClient);

module.exports = router;