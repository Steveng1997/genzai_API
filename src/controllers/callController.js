const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Obtener Config de IA
    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config)
      return res.status(404).json({ message: "Configuración no encontrada" });

    // 2. Obtener Clientes (Punto 4)
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({ TableName: "Clients" }),
    );

    // 3. Disparar llamadas con Metadata (Crucial para el reporte posterior)
    for (const cliente of clientes) {
      let phone = cliente.phone.toString().replace(/\D/g, "");
      if (phone.length === 10) phone = "57" + phone;
      const formattedPhone = phone.startsWith("+") ? phone : "+" + phone;

      try {
        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: cliente.fullName || "Cliente",
            },
            assistantId: config.assistantId,
            metadata: {
              businessId: businessId,
              businessName: config.businessName,
            },
          },
          {
            headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
          },
        );
      } catch (err) {
        console.error(`Error en número ${formattedPhone}`);
      }
    }

    res
      .status(200)
      .json({
        success: true,
        message: `Campaña iniciada (${clientes.length} clientes)`,
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
