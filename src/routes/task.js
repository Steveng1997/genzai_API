const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");

router.get("/", taskController.getTasks);
router.post("/add", taskController.createTask);
router.patch("/complete/:taskId", taskController.completeTask);

module.exports = router;
