const dynamoDB = require("../services/dynamo");
const { UpdateCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

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
    "assistant-detected-voicemail",
    "rejected",
  ];

  try {
    const finalStatus = failedReasons.includes(endedReason)
      ? "Followup_Required"
      : "Completed";

    // 1. Update client status
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "ClientesRiley",
        Key: { Phone: customerPhone },
        UpdateExpression: "SET #st = :s, lastCallAt = :t",
        ExpressionAttributeNames: { "#st": "Status" },
        ExpressionAttributeValues: {
          ":s": finalStatus,
          ":t": new Date().toISOString(),
        },
      }),
    );

    // 2. Deduct minutes
    if (userEmail && durationMin > 0) {
      const emailKey = userEmail.toLowerCase().trim();
      await dynamoDB.send(
        new UpdateCommand({
          TableName: "GenzaiUsers",
          Key: { email: emailKey },
          UpdateExpression:
            "SET minutos_disponibles = minutos_disponibles - :m",
          ExpressionAttributeValues: { ":m": durationMin },
        }),
      );
    }
  } catch (e) {
    console.error("Webhook error:", e);
  }
  res.sendStatus(200);
};
