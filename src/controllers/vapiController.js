const dynamoDB = require("../services/dynamo");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");

exports.handleWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📩 Webhook Vapi: ${type}`);

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};

      const historyItem = {
        // ID como Número (N) para evitar Type Mismatch en DynamoDB
        id: Date.now(),
        phone: callData.customer?.number || "Desconocido",
        name: "Cliente Genzai",
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
      console.log(`✅ Historial guardado para: ${historyItem.phone}`);
    }
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error Webhook:", e.message);
    res.status(500).json({ error: "Error en el servidor", detail: e.message });
  }
};
