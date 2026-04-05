const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo"); // Tu archivo de configuración de Dynamo
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ message: "Email es requerido" });

    // 1. Obtener configuración de Riley desde DynamoDB (Tabla AIConfigs)
    const configs = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
      }),
    );

    // Buscamos el asistente por el email del usuario
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    if (!userConfig || !userConfig.assistantId) {
      return res
        .status(404)
        .json({ message: "No se encontró configuración para Riley" });
    }

    // 2. Obtener lista de clientes (Tabla Clients)
    const clientsData = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS,
      }),
    );

    const clients = clientsData.Items || [];
    if (clients.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes en la tabla Clients" });
    }

    // 3. Lanzar llamadas masivas
    let callsCount = 0;
    for (const client of clients) {
      if (client.phone) {
        // Limpieza y formato E.164 (Ej: +573043277453)
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) {
          cleanPhone = `+57${cleanPhone}`;
        } else if (!cleanPhone.startsWith("+")) {
          cleanPhone = `+${cleanPhone}`;
        }

        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: userConfig.assistantId, // ID: 4c266662...
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660", // ID de tu captura
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`, // La Private Key (fa7a9e05...)
                "Content-Type": "application/json",
              },
            },
          );
          callsCount++;
        } catch (err) {
          console.error(
            `Error llamando a ${cleanPhone}:`,
            err.response?.data || err.message,
          );
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña finalizada. Intentos exitosos: ${callsCount} de ${clients.length}`,
    });
  } catch (e) {
    console.error("Error general:", e.message);
    res.status(500).json({ message: "Error interno: " + e.message });
  }
};
