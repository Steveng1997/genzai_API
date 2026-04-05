const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// Listar tareas para Flutter
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Actualizar estado desde Flutter
exports.completeTask = async (req, res) => {
  const { taskId, isCompleted } = req.body;
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Tasks",
        Key: { taskId: taskId },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Webhook unificado (Punto 6 y 7)
exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const type = payload.type;

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};
      const meta = callData.metadata || {};

      // Punto 6: Consumo (ID como Número)
      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: {
            id: Date.now(),
            businessId: meta.businessId || "default",
            phone: callData.customer?.number || "Desconocido",
            duration: `${Math.round(callData.duration || 0)} seg`,
            timestamp: new Date().toISOString(),
            businessName: meta.businessName || "General",
          },
        }),
      );
    }

    // Punto 7: Tarea detectada por IA (Ejemplo de evento Tool)
    if (type === "tool-calls") {
      // Aquí procesarías la extracción de datos de la IA para crear la tarea
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
