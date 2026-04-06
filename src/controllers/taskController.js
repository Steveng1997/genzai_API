const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// 1. Obtener tareas para Flutter
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    console.error("❌ Error al obtener tareas:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// 2. Actualizar estado de tarea desde Flutter
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

/**
 * 3. WEBHOOK UNIFICADO PARA VAPI
 * Versión corregida para garantizar la persistencia en DynamoDB
 */
exports.handleVapiWebhook = async (req, res) => {
  // Log detallado para depuración en App Runner
  console.log("📡 Payload recibido:", JSON.stringify(req.body));

  // Vapi puede enviar los datos en 'message' o directamente en el body
  const payload = req.body.message || req.body;
  const type = payload.type;
  const callData = payload.call || {};

  try {
    // Verificamos si es el reporte final o si al menos tenemos datos de la llamada
    if (type === "end-of-call-report" || callData.id) {
      const meta = callData.metadata || {};

      console.log("Attempting DynamoDB Put for call:", callData.id);

      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: {
            // CRÍTICO: Asegúrate de que este nombre coincida con la Partition Key de tu tabla
            id: callData.id || `vapi_${Date.now()}`,
            businessId: meta.businessId || "genzai_pro_01",
            phone: callData.customer?.number || "Desconocido",
            duration: `${Math.round(callData.duration || 0)} seg`,
            cost: callData.cost || 0,
            timestamp: new Date().toISOString(),
            businessName: meta.businessName || "autos",
            status: callData.endedReason || "completed",
          },
        }),
      );
      console.log("✅ Registro en ConsumptionHistory exitoso");
    }

    // Siempre respondemos 200 a Vapi para evitar reintentos innecesarios
    return res.status(200).json({ success: true });
  } catch (e) {
    // El error aparecerá en "Service logs" de App Runner
    console.error("❌ ERROR EN WEBHOOK:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
