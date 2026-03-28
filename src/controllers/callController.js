const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");
// Importar enviarWhatsApp de tus services

exports.vapiWebhook = async (req, res) => {
  const { message } = req.body;
  if (message?.type === "end-of-call-report") {
    const phone = message.customer?.number;
    const razon = message.endedReason;

    // Si no contestó (busy, no-answer, voicemail)
    if (
      [
        "voicemail",
        "no-answer",
        "customer-did-not-answer",
        "machine-detected",
        "assistant-detected-voicemail",
        "rejected",
        "customer-ended",
      ].includes(razon)
    ) {
      await docClient.send(
        new UpdateCommand({
          TableName: "ClientesRiley",
          Key: { Phone: phone },
          UpdateExpression: "SET #st = :s, LastInteraction = :t",
          ExpressionAttributeNames: { "#st": "Status" },
          ExpressionAttributeValues: {
            ":s": "Seguimiento_Diario",
            ":t": new Date().toISOString(),
          },
        }),
      );
      // Aquí disparas el primer WhatsApp de "no pudimos hablar"
    } else {
      // Si contestó, fin del flujo
      await docClient.send(
        new UpdateCommand({
          TableName: "ClientesRiley",
          Key: { Phone: phone },
          UpdateExpression: "SET #st = :s",
          ExpressionAttributeNames: { "#st": "Status" },
          ExpressionAttributeValues: { ":s": "Finalizado" },
        }),
      );
    }
  }
  res.sendStatus(200);
};
