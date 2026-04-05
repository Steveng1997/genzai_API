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

    // 1. Obtener configuración del asistente
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    if (!userConfig || !userConfig.assistantId) {
      return res
        .status(404)
        .json({ success: false, message: "Riley no está configurada aún" });
    }

    // 2. Obtener clientes de la tabla 'Clients'
    const clientsData = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS,
      }),
    );

    const clients = clientsData.Items || [];
    if (clients.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "No hay clientes en la base de datos",
        });
    }

    const results = [];

    // 3. Lanzar llamadas masivas
    for (const client of clients) {
      if (client.phone) {
        // IMPORTANTE: Vapi requiere formato internacional (+57...)
        // Limpiamos el número de espacios o caracteres extra
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (!cleanPhone.startsWith("+")) cleanPhone = `+${cleanPhone}`;

        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: userConfig.assistantId,
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660", // Asegúrate que este ID sea el correcto
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );
          results.push({ phone: cleanPhone, status: "success" });
        } catch (err) {
          console.error(
            `Error llamando a ${cleanPhone}:`,
            err.response?.data || err.message,
          );
          results.push({ phone: cleanPhone, status: "failed" });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña procesada para ${results.length} números encontrados.`,
    });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, message: "Error interno del servidor" });
  }
};
