const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// --- FUNCIONES PARA FLUTTER ---

exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

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

// --- WEBHOOK VAPI (EXTRACCIÓN ROBUSTA) ---

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const { type, call } = payload;

  // Solo procesamos el reporte final de la llamada
  if (type !== "end-of-call-report") {
    return res.status(200).json({ message: "Evento ignorado" });
  }

  try {
    const metadata = call?.metadata || {};

    // 1. Extracción de Duración: Intentamos varias fuentes de Vapi
    // Si durationSeconds es 0, restamos el tiempo de fin menos el de inicio (Fallback)
    let seconds =
      call?.durationSeconds || payload?.durationSeconds || call?.duration || 0;

    if (Number(seconds) === 0 && call?.startedAt && call?.endedAt) {
      const start = new Date(call.startedAt);
      const end = new Date(call.endedAt);
      seconds = (end - start) / 1000;
    }

    // 2. Extracción de Costo: Buscamos en raíz, en call y en el análisis
    const cost = call?.cost || payload?.cost || call?.analysis?.cost || 0;

    const finalDuration = Math.round(Number(seconds) || 0);
    const finalCost = Number(cost) || 0;

    console.log(
      `💾 Procesando: ${call?.id} | Segundos: ${finalDuration} | Costo: ${finalCost}`,
    );

    await dynamoDB.send(
      new PutCommand({
        TableName: "ConsumptionHistory",
        Item: {
          id: String(call?.id || payload?.callId || Date.now()),
          businessId: metadata.businessId || "unknown",
          businessName: metadata.businessName || "N/A",
          phone: call?.customer?.number || "N/A",
          duration: `${finalDuration} seg`,
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
