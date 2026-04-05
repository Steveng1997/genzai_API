const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.handleWebhook = async (req, res) => {
  // Vapi suele enviar los datos dentro de un objeto 'message'
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📩 Evento Vapi detectado: ${type}`);

  try {
    // Solo guardamos cuando la llamada termina realmente
    if (type === "end-of-call-report") {
      const callData = payload.call || {};
      const durationSeconds = callData.duration || 0;
      const customerPhone = callData.customer?.number || "Desconocido";

      const historyItem = {
        historyId: `CALL-${Date.now()}`,
        phone: customerPhone,
        name: "Cliente Genzai",
        duration: `${durationSeconds} seg`,
        status: callData.endedReason || "completed",
        timestamp: new Date().toISOString(),
        cost: callData.cost || 0,
        businessName: "autos", // Opcional: puedes hacerlo dinámico
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory",
          Item: historyItem,
        }),
      );

      console.log(
        `✅ Registro guardado en ConsumptionHistory para ${customerPhone}`,
      );
    }

    // Vapi necesita un 200 OK siempre para confirmar recepción
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error en Webhook:", e.message);
    res.status(500).send("Error interno");
  }
};
