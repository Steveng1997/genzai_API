const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Obtener Config de IA (Incluyendo el ID del teléfono de Vapi)
    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config || !config.assistantId) {
      return res
        .status(404)
        .json({ message: "Configuración no encontrada o incompleta" });
    }

    // 2. Obtener Clientes
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({ TableName: "Clients" }),
    );

    // 3. Disparar llamadas
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
            // --- CORRECCIÓN AQUÍ: Debes pasar el ID del número que compraste en Vapi ---
            phoneNumberId:
              config.vapiPhoneNumberId || "TU_PHONE_NUMBER_ID_DE_VAPI",
            metadata: {
              businessId: businessId,
              businessName: config.businessName,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );
        console.log(`✅ Orden enviada para ${formattedPhone}`);
      } catch (err) {
        console.error(`❌ Error en Vapi:`, err.response?.data || err.message);
      }
    }

    res.status(200).json({
      success: true,
      message: `Campaña iniciada (${clientes.length} clientes)`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
