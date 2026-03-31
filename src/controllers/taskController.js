const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

// Nombre de la tabla según tu nueva estructura en AWS
const TABLE_NAME = "Tasks";

// 1. Obtener todas las tareas (Esta es la que faltaba y causaba el error)
exports.getTasks = async (req, res) => {
  const command = new ScanCommand({
    TableName: TABLE_NAME,
  });

  try {
    const response = await docClient.send(command);
    // Retornamos los items o un array vacío si no hay nada
    res.status(200).json(response.Items || []);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: error.message });
  }
};

// 2. Crear Tarea
exports.createTask = async (req, res) => {
  const { subject, Name, description, dueDate } = req.body;

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      // taskId es numérico (N) en tu tabla
      taskId: Date.now(),
      subject: subject,
      Name: Name,
      description: description,
      dueDate: dueDate,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    },
  });

  try {
    await docClient.send(command);
    res.status(201).json({ message: "Task created successfully" });
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: error.message });
  }
};

// 3. Completar Tarea
exports.completeTask = async (req, res) => {
  const { taskId } = req.params;

  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      // Conversión obligatoria a Number para el tipo (N) de la Partition Key
      taskId: Number(taskId),
    },
    UpdateExpression: "set #s = :status",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":status": "COMPLETED" },
  });

  try {
    await docClient.send(command);
    res.status(200).json({ message: "Task completed" });
  } catch (error) {
    console.error("Error completing task:", error);
    res.status(500).json({ error: error.message });
  }
};

// 4. Eliminar Tarea
exports.deleteTask = async (req, res) => {
  const { taskId } = req.params;

  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      taskId: Number(taskId),
    },
  });

  try {
    await docClient.send(command);
    res.status(200).json({ message: "Task deleted" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ error: error.message });
  }
};
