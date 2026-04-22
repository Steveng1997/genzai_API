const express = require("express");
const router = express.Router();
const serviceController = require("../controllers/servicesController");

router.post("/save", serviceController.createService);
router.get("/tenant/:tenantId", serviceController.getServicesByTenant);
router.get("/:tenantId/:serviceId", serviceController.getServiceById);
router.get("/count/:tenantId", serviceController.countServicesByTenant);
router.put("/update", serviceController.updateService);
router.delete("/delete/:tenantId/:serviceId", serviceController.deleteService);

module.exports = router;
