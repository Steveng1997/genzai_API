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

    // 1. Obtener configuración del asistente (Tabla AIConfigs en us-east-2)
    const configs = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
      }),
    );

    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    // 2. Definir Assistant ID con respaldo (Fallback) para evitar error de UUID
    // Usamos el ID de tu captura de pantalla image_e514ea.jpg
    const finalAssistantId =
      userConfig?.assistantId || "4c266662-68db-4046-a13f-8c02829288e9";

    // 3. Obtener clientes de la base de datos (Tabla Clients)
    const clientsData = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS,
      }),
    );

    const clients = clientsData.Items || [];
    if (clients.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No hay clientes para llamar" });
    }

    const results = [];

    // 4. Bucle de llamadas
    for (const client of clients) {
      if (client.phone) {
        // Formateo E.164 para Colombia (+57...)
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) {
          cleanPhone = `+57${cleanPhone}`;
        } else if (!cleanPhone.startsWith("+")) {
          cleanPhone = `+${cleanPhone}`;
        }

        try {
          // Petición a Vapi usando la Private Key fa7a9e05...
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: finalAssistantId,
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660", // De tu captura
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
            `❌ Error en Vapi para ${cleanPhone}:`,
            err.response?.data || err.message,
          );
          results.push({
            phone: cleanPhone,
            status: "failed",
            error: err.response?.data,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña procesada. Intentos: ${results.length}`,
      details: results,
    });
  } catch (e) {
    console.error("💥 Error Crítico:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};
