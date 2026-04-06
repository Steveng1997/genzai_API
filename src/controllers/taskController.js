const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

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
    // Cambiado a String para mantener el .10 en la base de datos
    const finalCost = Number(rawCost).toFixed(2);

    console.log(
      `💾 Guardando: ${call?.id} | Duración: ${durationFormatted} | Costo: ${finalCost}`,
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
