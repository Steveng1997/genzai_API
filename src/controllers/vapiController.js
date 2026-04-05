const dynamoDB = require("../services/dynamo");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");

exports.handleWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📩 Webhook Vapi recibido: ${type}`);

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};

      const historyItem = {
        // CORRECCIÓN CRÍTICA: Convertimos el ID a Número (N) para que coincida con tu tabla
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

      console.log(
        `✅ Registro guardado exitosamente con ID numérico: ${historyItem.id}`,
      );
    }

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error DynamoDB Historial:", e.message);
    // Si sigue fallando, este log nos dirá si es por otra columna
    res.status(500).json({ error: "Error de tipo de dato", detail: e.message });
  }
};
