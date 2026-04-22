const express = require("express");
const router = express.Router();
const productController = require("../controllers/productsController");

router.post("/save", productController.createProduct);
router.get("/tenant/:tenantId", productController.getProductsByTenant);
router.get("/count/:tenantId", productController.countProductsByTenant);
router.put("/update", productController.updateProduct);
router.get("/:tenantId/:productId", productController.getProductById);
router.delete("/delete/:tenantId/:productId", productController.deleteProduct);

module.exports = router;