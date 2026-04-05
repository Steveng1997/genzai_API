const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email es requerido" });

    // 1. Buscar el asistente en la tabla 'AIConfigs' (DYNAMODB_TABLE_AI)
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
        .json({
          success: false,
          message: "Asistente Riley no configurado en la DB",
        });
    }

    // 2. Obtener clientes de la tabla 'Clients' (DYNAMODB_TABLE_LEADS)
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
          message: "No hay clientes registrados para llamar",
        });
    }

    const results = [];

    // 3. Bucle de llamadas masivas
    for (const client of clients) {
      if (client.phone) {
        // LIMPIEZA DE NÚMERO: Formato E.164 (+57...)
        let cleanPhone = client.phone.toString().replace(/\D/g, "");

        // Si el número tiene 10 dígitos (ej: 304...), asumimos Colombia y ponemos +57
        if (cleanPhone.length === 10) {
          cleanPhone = `+57${cleanPhone}`;
        } else if (!cleanPhone.startsWith("+")) {
          cleanPhone = `+${cleanPhone}`;
        }

        try {
          // LLAMADA A VAPI
          const vapiResponse = await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: userConfig.assistantId, // ID: 4c266662...
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660", // Tu ID de número
            },
            {
              headers: {
                // IMPORTANTE: Asegúrate que esta variable en App Runner sea la Private Key (fa7a9e05...)
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );

          results.push({
            phone: cleanPhone,
            status: "success",
            id: vapiResponse.data.id,
          });
        } catch (err) {
          console.error(
            `❌ Error Vapi para ${cleanPhone}:`,
            err.response?.data || err.message,
          );
          results.push({
            phone: cleanPhone,
            status: "failed",
            error: err.response?.data?.message || err.message,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña finalizada. Intentos: ${results.length}`,
      details: results,
    });
  } catch (e) {
    console.error("💥 Error Crítico:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};
