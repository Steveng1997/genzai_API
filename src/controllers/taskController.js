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
 * Corregido para satisfacer la Partition Key "id" de DynamoDB
 */
exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📡 Solicitud Webhook recibida. Tipo: ${type}`);

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};
      const meta = callData.metadata || {};
      const analysis = payload.analysis || {};

      // CORRECCIÓN CRÍTICA: Se agrega el campo 'id' que la tabla exige
      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: {
            id: callData.id || `call_${Date.now()}`, // <--- CLAVE PRIMARIA OBLIGATORIA
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
      console.log("✅ ConsumptionHistory actualizado exitosamente.");

      // Lógica para crear Tareas (Tabla 'Tasks' usa 'taskId' como clave)
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

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error procesando Webhook de Vapi:", e.message);
    res.status(500).json({ error: e.message });
  }
};
