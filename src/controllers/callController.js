const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId, company } = req.body; // Se requiere la compañía para filtrar

    if (!company) {
      return res
        .status(400)
        .json({ message: "La compañía es requerida para filtrar clientes" });
    }

    // 1. Obtener Configuración usando la compañía como ID de negocio
    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: process.env.DYNAMODB_TABLE_AI || "AIConfigs",
        Key: { businessId: company },
      }),
    );

    if (!config || !config.assistantId || !config.vapiPhoneNumberId) {
      return res
        .status(404)
        .json({ message: "Configuración incompleta en AIConfigs" });
    }

    // 2. Obtener lista de Clientes FILTRADOS por compañía
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_LEADS || "Clients",
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    if (!clientes || clientes.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes registrados para esta compañía" });
    }

    // 3. Disparar llamadas
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
              phoneNumberId: config.vapiPhoneNumberId,
              metadata: {
                businessId: company,
                company: company,
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
