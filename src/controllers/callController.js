const axios = require("axios");
const { QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Obtener la configuración de la IA (el ID del asistente Riley)
    const aiConfig = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId.toLowerCase().trim() },
      }),
    );

    if (!aiConfig.Item || !aiConfig.Item.assistantId) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Debes configurar a Riley con un PDF o instrucción primero.",
        });
    }

    // 2. Obtener clientes habilitados para este negocio
    const clientsData = await dynamoDB.send(
      new QueryCommand({
        TableName: "Clients",
        KeyConditionExpression: "businessId = :bid",
        FilterExpression: "isEnabled = :enabled",
        ExpressionAttributeValues: { ":bid": businessId, ":enabled": true },
      }),
    );

    const clients = clientsData.Items || [];
    if (clients.length === 0) {
      return res
        .status(200)
        .json({
          success: false,
          message: "No hay clientes marcados para llamar.",
        });
    }

    // 3. Lanzar llamadas a través de Vapi
    let callsSent = 0;
    for (const client of clients) {
      const phoneNumber = client.Celular || client.phone;
      if (phoneNumber) {
        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: phoneNumber,
              name: client.nombre || "Cliente",
            },
            assistantId: aiConfig.Item.assistantId, // ID que creamos en aiController
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
            },
          },
        );
        callsSent++;
      }
    }

    res.status(200).json({ success: true, count: callsSent });
  } catch (error) {
    console.error("Error en makeSmartCall:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.vapiWebhook = async (req, res) => {
  // Para recibir el resumen de la llamada (análisis de sentimientos, si compró, etc.)
  console.log("Webhook de Vapi recibido:", req.body);
  res.status(200).send("OK");
};
