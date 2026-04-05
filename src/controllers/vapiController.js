exports.handleWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  const type = payload.type;

  console.log(`📩 Webhook Vapi: ${type}`);

  try {
    if (type === "end-of-call-report") {
      const callData = payload.call || {};

      const historyItem = {
        id: `CALL-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // ID único garantizado
        phone: callData.customer?.number || "Desconocido",
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

      console.log(`✅ Guardado en historial: ${historyItem.phone}`);
    }
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error DynamoDB Historial:", e.message);
    res.status(500).json({ error: e.message });
  }
};
