const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// 1. Obtener todas las tareas para mostrar en Flutter
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    console.error("❌ Error al obtener tareas:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// 2. Actualizar estado de una tarea desde Flutter
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
 * 3. WEBHOOK UNIFICADO PARA VAPI (VERSIÓN ROBUSTA)
 */
exports.handleVapiWebhook = async (req, res) => {
  // Capturamos TODO lo que llegue para debuggear
  console.log("📡 BODY RECIBIDO COMPLETO:", JSON.stringify(req.body));

  const message = req.body.message || req.body;
  const type = message.type;

  try {
    // Si es un reporte de llamada, guardamos SI O SI
    if (type === "end-of-call-report" || req.body.call) {
      const callData = message.call || req.body.call || {};
      const meta = callData.metadata || {};

      console.log("Attempting DynamoDB Put...");

      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: {
            // CLAVE PRIMARIA OBLIGATORIA 'id'
            id: callData.id || `vapi_${Date.now()}`,
            businessId: meta.businessId || "genzai_pro_01",
            phone: callData.customer?.number || "Desconocido",
            duration: `${Math.round(callData.duration || 0)} seg`,
            cost: callData.cost || 0,
            timestamp: new Date().toISOString(),
            businessName: meta.businessName || "autos",
          },
        }),
      );
      console.log("✅ Registro en ConsumptionHistory exitoso");
    }

    // Respuesta rápida a Vapi para evitar timeouts
    return res.status(200).json({ success: true });
  } catch (e) {
    // Si hay error de DynamoDB, AQUÍ aparecerá en tus logs de App Runner
    console.error("❌ ERROR CRÍTICO WEBHOOK:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
