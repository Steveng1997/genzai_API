const express = require("express");
const router = express.Router();
const productsController = require("../controllers/productsController");

router.post("/", productsController.createProduct);
router.get("/:tenantId", productsController.getProductsByTenant);
router.put("/update", productsController.updateProduct);
router.delete("/:tenantId/:productId", productsController.deleteProduct);

module.exports = router;