const dynamoDB = require("../services/dynamo");
const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
// const { sendWhatsApp } = require("../services/whatsapp"); // Asumiendo que tienes este servicio

exports.vapiWebhook = async (req, res) => {
  const { message } = req.body;
  if (message?.type !== "end-of-call-report") return res.sendStatus(200);

  const customerPhone = message.customer?.number;
  const durationMin = parseFloat(
    ((message.durationSeconds || 0) / 60).toFixed(2),
  );
  const userEmail = message.assistant?.variableValues?.userEmail;
  const endedReason = message.endedReason;

  const failedReasons = [
    "voicemail",
    "no-answer",
    "customer-did-not-answer",
    "machine-detected",
    "rejected",
  ];

  try {
    const isFailed = failedReasons.includes(endedReason);
    const finalStatus = isFailed ? "Followup_Required" : "Completed";

    // 1. Actualizar Cliente
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Clients",
        Key: { Phone: customerPhone },
        UpdateExpression: "SET #st = :s, lastCallAt = :t",
        ExpressionAttributeNames: { "#st": "Status" },
        ExpressionAttributeValues: {
          ":s": finalStatus,
          ":t": new Date().toISOString(),
        },
      }),
    );

    // 2. Cobrar Minutos
    if (userEmail && durationMin > 0) {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: "Users",
          Key: { email: userEmail.toLowerCase().trim() },
          UpdateExpression:
            "SET minutos_disponibles = minutos_disponibles - :m",
          ExpressionAttributeValues: { ":m": durationMin },
        }),
      );
    }

    // 3. WhatsApp Automático si falla
    if (isFailed) {
      console.log(
        `Llamada fallida (${endedReason}). Disparando WhatsApp a ${customerPhone}`,
      );
      // await sendWhatsApp(customerPhone, "Hola, intentamos llamarte pero no pudimos contactarte.");
    }
  } catch (e) {
    console.error("Webhook error:", e);
  }
  res.sendStatus(200);
};
