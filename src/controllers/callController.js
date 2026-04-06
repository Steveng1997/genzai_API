const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    if (!businessId) {
      return res.status(400).json({ message: "businessId es requerido" });
    }

    // 1. Obtener Configuración (AssistantID y PhoneNumberID desde la DB)
    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config || !config.assistantId || !config.vapiPhoneNumberId) {
      return res.status(404).json({
        message: "Configuración incompleta en la tabla AIConfigs",
      });
    }

    // 2. Obtener lista de Clientes
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({ TableName: "Clients" }),
    );

    if (!clientes || clientes.length === 0) {
      return res.status(404).json({ message: "No hay clientes para llamar" });
    }

    // 3. Disparar llamadas masivas
    const results = await Promise.all(
      clientes.map(async (cliente) => {
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
              phoneNumberId: config.vapiPhoneNumberId, // Dinámico desde DB
              metadata: {
                businessId: businessId,
                businessName: config.businessName || "Empresa",
              },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );
          return { phone: formattedPhone, status: "success" };
        } catch (err) {
          return { phone: formattedPhone, status: "error", error: err.message };
        }
      }),
    );

    res.status(200).json({
      success: true,
      message: `Proceso terminado para ${clientes.length} clientes`,
      results,
    });
  } catch (e) {
    console.error("❌ Error en makeSmartCall:", e.message);
    res.status(500).json({ error: e.message });
  }
};
