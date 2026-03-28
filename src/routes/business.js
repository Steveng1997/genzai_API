const express = require("express");
const router = express.Router();
// Importamos el controlador
const businessController = require("../controllers/businessController");

// Verificamos que la función exista antes de asignarla para evitar el error
if (businessController.confirmarTodo) {
  router.post("/confirmar-todo", businessController.confirmarTodo);
} else {
  console.error(
    "❌ ERROR: La función 'confirmarTodo' no existe en businessController.js",
  );
}

module.exports = router;
