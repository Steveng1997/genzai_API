const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();

    // 1. Obtener asistente de la tabla 'AIConfigs'
    const configs = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
      }),
    );
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    if (!userConfig || !userConfig.assistantId) {
      return res
        .status(404)
        .json({ message: "Asistente Riley no configurado" });
    }

    // 2. Obtener clientes de la tabla 'Clients'
    const clientsData = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS,
      }),
    );

    const clients = clientsData.Items || [];

    // 3. Lanzar llamadas masivas
    for (const client of clients) {
      if (client.phone) {
        // Limpiamos el número de espacios para Vapi
        const cleanPhone = client.phone.toString().replace(/\s+/g, "");

        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: userConfig.assistantId, // Tu ID: 4c266662...
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660", // ID de tu número Vapi
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`, // Usa la Private Key corregida
                "Content-Type": "application/json",
              },
            },
          );
        } catch (err) {
          console.error(
            `Fallo al llamar a ${cleanPhone}:`,
            err.response?.data || err.message,
          );
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña procesada para ${clients.length} números encontrados.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
