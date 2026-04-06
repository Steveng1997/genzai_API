const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// Obtener todas las tareas (para tu App de Flutter)
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Marcar tarea como completada
exports.completeTask = async (req, res) => {
  const { taskId, isCompleted } = req.body;
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Tasks",
        Key: { taskId },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVA FUNCIÓN: Riley crea una tarea durante la llamada
exports.handleRileyTool = async (req, res) => {
  try {
    const payload = req.body.message || req.body;
    // Vapi envía los datos en toolCalls cuando Riley usa una herramienta
    const toolCall = payload.toolCalls?.[0] || payload.toolCallList?.[0];

    if (!toolCall) return res.status(400).json({ error: "No tool call data" });

    const { titulo, detalle } = toolCall.function.arguments;

    const newTask = {
      taskId: Date.now(),
      title: titulo,
      description: detalle || "Sin detalles adicionales",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: "Tasks",
        Item: newTask,
      }),
    );

    // Esta respuesta le confirma a Riley que la tarea se guardó
    return res.status(200).json({
      results: [
        {
          toolCallId: toolCall.id,
          result: "Tarea guardada exitosamente en el sistema.",
        },
      ],
    });
  } catch (e) {
    console.error("❌ Error en Riley Tool:", e.message);
    return res.status(500).json({ error: e.message });
  }
};

// Webhook para el historial de consumo (al finalizar la llamada)
exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const { type, call } = payload;

  if (type !== "end-of-call-report") {
    return res.status(200).json({ message: "Evento ignorado" });
  }

  try {
    const metadata = call?.metadata || {};

    let seconds =
      call?.durationSeconds || payload?.durationSeconds || call?.duration || 0;
    if (Number(seconds) === 0 && call?.startedAt && call?.endedAt) {
      seconds = (new Date(call.endedAt) - new Date(call.startedAt)) / 1000;
    }

    const totalSeconds = Math.round(Number(seconds) || 0);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const durationFormatted = `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;

    const rawCost = call?.cost || payload?.cost || call?.analysis?.cost || 0;
    const finalCost = Number(rawCost).toFixed(2);

    console.log(
      `💾 Registro de llamada: ${call?.id} | Duración: ${durationFormatted} | Costo: ${finalCost}`,
    );

    await dynamoDB.send(
      new PutCommand({
        TableName: "ConsumptionHistory",
        Item: {
          id: String(call?.id || payload?.callId || Date.now()),
          businessId: metadata.businessId || "unknown",
          businessName: metadata.businessName || "N/A",
          phone: call?.customer?.number || "N/A",
          duration: durationFormatted,
          cost: finalCost,
          status: call?.endedReason || "completed",
          timestamp: new Date().toISOString(),
        },
      }),
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ ERROR WEBHOOK:", error.message);
    return res.status(200).json({ error: error.message });
  }
};
