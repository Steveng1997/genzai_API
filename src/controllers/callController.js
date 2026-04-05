const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email requerido" });

    // 1. Obtener configuración de Riley para el usuario
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    if (!userConfig || !userConfig.assistantId) {
      return res
        .status(404)
        .json({ success: false, message: "IA no entrenada" });
    }

    // 2. Obtener lista de clientes de la tabla 'Clients'
    const clientsData = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS,
      }),
    );

    const clients = clientsData.Items || [];
    if (clients.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No hay clientes registrados" });
    }

    // 3. Lanzar llamadas masivas
    const results = [];
    for (const client of clients) {
      if (client.phone) {
        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: client.phone },
              assistantId: userConfig.assistantId,
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-1394...", // Tu ID de número Vapi
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`, // Asegúrate que sea la Private Key
                "Content-Type": "application/json",
              },
            },
          );
          results.push({ phone: client.phone, status: "ok" });
        } catch (err) {
          results.push({ phone: client.phone, status: "error" });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña iniciada para ${results.length} clientes.`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
