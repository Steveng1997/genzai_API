const axios = require("axios");
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// 1. DISPARAR LA LLAMADA TELEFÓNICA
exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId, clientId } = req.body;

    // Buscamos al cliente en DynamoDB
    const clientData = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { businessId: businessId, clientId: clientId },
      }),
    );

    if (!clientData.Item || !clientData.Item.phone) {
      return res
        .status(404)
        .json({ message: "Cliente o teléfono no encontrado" });
    }

    // Buscamos la configuración de Riley para ese negocio
    const config = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config.Item || !config.Item.assistantId) {
      return res
        .status(404)
        .json({ message: "Riley no está configurado (Faltan PDFs)" });
    }

    // Llamada saliente vía Vapi API
    const vapiResponse = await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: {
          number: clientData.Item.phone,
          name: clientData.Item.name || "Cliente GNA",
        },
        assistantId: config.Item.assistantId,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // ID del número comprado en Vapi
      },
      {
        headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      },
    );

    res.status(200).json({
      success: true,
      callId: vapiResponse.data.id,
    });
  } catch (error) {
    console.error("Error en Vapi:", error.response?.data || error.message);
    res.status(500).json({ error: "Error al conectar con Vapi" });
  }
};

// 2. WEBHOOK PARA REPORTE FINAL Y COBRO DE MINUTOS
exports.vapiWebhook = async (req, res) => {
  const { message } = req.body;
  if (message?.type !== "end-of-call-report") return res.sendStatus(200);

  const customerPhone = message.customer?.number;
  const durationMin = parseFloat(
    ((message.durationSeconds || 0) / 60).toFixed(2),
  );
  // Asegúrate de que el asistente envíe esta variable o búscala en tu DB
  const userEmail =
    message.assistant?.variableValues?.userEmail || "steven@example.com";
  const endedReason = message.endedReason;

  const failedReasons = [
    "voicemail",
    "no-answer",
    "customer-did-not-answer",
    "rejected",
  ];

  try {
    const isFailed = failedReasons.includes(endedReason);
    const finalStatus = isFailed ? "Followup_Required" : "Completed";

    // Actualizar estado del cliente
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Clients",
        Key: { Phone: customerPhone }, // Verifica si tu PK es 'Phone' o 'clientId'
        UpdateExpression: "SET #st = :s, lastCallAt = :t",
        ExpressionAttributeNames: { "#st": "Status" },
        ExpressionAttributeValues: {
          ":s": finalStatus,
          ":t": new Date().toISOString(),
        },
      }),
    );

    // Descontar minutos del usuario
    if (durationMin > 0) {
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
  } catch (e) {
    console.error("Webhook error:", e);
  }
  res.sendStatus(200);
};
