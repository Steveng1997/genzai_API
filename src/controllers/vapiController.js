const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.handleWebhook = async (req, res) => {
  // Vapi a veces envuelve el JSON en una propiedad 'message'
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📩 Webhook Vapi: ${type}`);

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};

      const historyItem = {
        historyId: `CALL-${Date.now()}`,
        phone: callData.customer?.number || "Desconocido",
        name: callData.customer?.name || "Cliente Genzai",
        duration: `${callData.duration || 0} seg`,
        status: callData.endedReason || "completed",
        timestamp: new Date().toISOString(),
        cost: callData.cost || 0,
        businessName: "autos",
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: historyItem,
        }),
      );

      console.log(`✅ Historial guardado para ${historyItem.phone}`);
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error Webhook:", e.message);
    res.status(500).send("Error");
  }
};
