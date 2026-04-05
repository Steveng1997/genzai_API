const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.handleWebhook = async (req, res) => {
  // Este log es para que confirmes en los logs de AWS que Vapi te contactó
  console.log("📩 Webhook de Vapi recibido. Tipo de evento:", req.body.type);

  try {
    const { type, call } = req.body;

    // Solo nos interesa el reporte final (end-of-call-report)
    if (type === "end-of-call-report") {
      const historyItem = {
        historyId: `CALL-${Date.now()}`,
        phone: call.customer?.number || "Privado",
        name: call.customer?.name || "Cliente Genzai",
        duration: `${call.duration || 0} seg`,
        status: call.endedReason || "finished",
        timestamp: new Date().toISOString(),
        cost: call.cost || 0,
        businessName: "autos",
      };

      await dynamoDB.send(
        new PutCommand({
          TableName: "ConsumptionHistory", // Asegúrate que el nombre sea idéntico en Dynamo
          Item: historyItem,
        }),
      );

      console.log(`✅ Registro guardado para ${historyItem.phone}`);
    }

    // Vapi necesita que le respondas 200 siempre
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Error en Webhook:", error.message);
    res.status(500).send("Error");
  }
};
