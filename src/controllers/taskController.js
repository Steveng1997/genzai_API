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
 * 3. WEBHOOK UNIFICADO PARA VAPI
 * Este endpoint procesa el fin de la llamada y la extracción de datos.
 */
exports.handleVapiWebhook = async (req, res) => {
  // Soporta ambos formatos de envío de Vapi
  const payload = req.body.message || req.body;
  const type = payload.type;

  // Log para verificar en App Runner si Vapi está llegando
  console.log(`📡 Solicitud Webhook recibida. Tipo: ${type}`);

  try {
    // EVENTO: Reporte final de la llamada (Para Consumo)
    if (type === "end-of-call-report") {
      const callData = payload.call || {};
      const meta = callData.metadata || {};
      const analysis = payload.analysis || {};

      // Guardar en ConsumptionHistory
      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: {
            // Clave de partición obligatoria según tu tabla
            businessId: meta.businessId || "genzai_pro_01",
            // ID único de llamada para evitar sobrescribir registros si usas Sort Key
            callId: callData.id,
            phone: callData.customer?.number || "Desconocido",
            duration: `${Math.round(callData.duration || 0)} seg`,
            cost: callData.cost || 0,
            timestamp: new Date().toISOString(),
            businessName: meta.businessName || "autos",
            status: callData.endedReason || "completed",
          },
        }),
      );
      console.log("✅ ConsumptionHistory actualizado exitosamente.");

      // EVENTO: Crear Tarea si la IA detectó información estructurada
      // Si configuraste "Structured Data" en Vapi, aquí se crean las tareas automáticamente
      if (
        analysis.structuredData &&
        Object.keys(analysis.structuredData).length > 0
      ) {
        const taskData = analysis.structuredData;

        await dynamoDB.send(
          new PutCommand({
            TableName: "Tasks",
            Item: {
              taskId: `task_${Date.now()}`,
              businessId: meta.businessId || "genzai_pro_01",
              description:
                taskData.task || taskData.summary || "Seguimiento de llamada",
              customerName: callData.customer?.name || "N/A",
              isCompleted: false,
              createdAt: new Date().toISOString(),
            },
          }),
        );
        console.log("✅ Nueva tarea creada desde el análisis de la IA.");
      }
    }

    // Vapi requiere un 200 OK para confirmar recepción
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error procesando Webhook de Vapi:", e.message);
    res.status(500).json({ error: e.message });
  }
};
