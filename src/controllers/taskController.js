const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// --- FUNCIONES PARA FLUTTER ---

// Obtener todas las tareas
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    console.error("❌ Error al obtener tareas:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// Actualizar estado de una tarea
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
    console.error("❌ Error al actualizar tarea:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// --- WEBHOOK PARA VAPI ---

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const { type, call } = payload;

  try {
    // FILTRO: Solo procesamos el reporte final para evitar errores de "Missing ID"
    if (type !== "end-of-call-report") {
      return res.status(200).json({ message: "Evento ignorado" });
    }

    const metadata = call?.metadata || {};

    console.log(`💾 Guardando consumo para la llamada: ${call.id}`);

    await dynamoDB.send(
      new PutCommand({
        TableName: "ConsumptionHistory",
        Item: {
          id: call.id, // Partition Key
          businessId: metadata.businessId || "desconocido",
          businessName: metadata.businessName || "N/A",
          phone: call.customer?.number || "N/A",
          duration: `${Math.round(call.duration || 0)} seg`,
          cost: call.cost || 0,
          status: call.endedReason || "completed",
          timestamp: new Date().toISOString(),
        },
      }),
    );

    console.log("✅ Registro en ConsumptionHistory exitoso");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ ERROR WEBHOOK:", error.message);
    return res.status(200).json({ error: error.message });
  }
};
