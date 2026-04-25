const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");

router.get("/", clientController.getAllClients);
router.get("/count", clientController.getClientCount);
router.get("/:tenantId/:clientId", clientController.getClientById);
router.post("/save", clientController.saveClient);
router.put("/update", clientController.updateBasicInfo);
router.delete("/delete/:tenantId/:clientId", clientController.deleteClient);

module.exports = router;
