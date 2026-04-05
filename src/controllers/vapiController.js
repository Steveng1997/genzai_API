const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.handleWebhook = async (req, res) => {
  try {
    const { type, call } = req.body;

    // Solo registramos cuando la llamada termina
    if (type === "end-of-call-report") {
      const durationSeconds = call.duration || 0;
      const customerPhone = call.customer?.number || "Desconocido";

      // Intentamos sacar el nombre si Vapi lo capturó
      const customerName = call.customer?.name || "Cliente Genzai";

      const historyItem = {
        historyId: `CALL-${Date.now()}`, // ID único para la tabla
        phone: customerPhone,
        name: customerName,
        duration: `${durationSeconds} seg`,
        status: call.endedReason || "completed",
        timestamp: new Date().toISOString(),
        cost: call.cost || 0,
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: process.env.DYNAMODB_TABLE_HISTORY || "ConsumptionHistory",
          Item: historyItem,
        }),
      );

      console.log(
        `✅ Historial guardado: ${customerPhone} duró ${durationSeconds}s`,
      );
    }

    // Vapi necesita que respondas 200 siempre
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error Webhook Vapi:", e.message);
    res.status(500).send("Error");
  }
};
