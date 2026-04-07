const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;
  console.log(`🚀 Iniciando campaña para la empresa: ${company}`);

  try {
    if (!company) {
      return res
        .status(400)
        .json({ message: "ID de empresa no proporcionado" });
    }

    // 1. Obtener configuración de IA
    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: company },
      }),
    );

    if (!config) {
      console.error(`❌ Error: No hay configuración de IA para ${company}`);
      return res
        .status(404)
        .json({ message: "No hay IA configurada para " + company });
    }

    // 2. Obtener Clientes filtrados por compañía
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: "Clients",
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    if (!clientes || clientes.length === 0) {
      console.warn(
        `⚠️ Advertencia: No hay clientes registrados para ${company}`,
      );
      return res
        .status(404)
        .json({ message: "No hay clientes registrados para " + company });
    }

    // Usar el número de la DB o el de respaldo (Asegúrate que este ID sea el correcto en tu Vapi Dashboard)
    const activePhoneNumberId =
      config.vapiPhoneNumberId || "59d1cef7-80b8-4dfa-9a14-1394df3bc97a";

    // 3. Ejecutar llamadas con Logs de respuesta de Vapi
    const calls = clientes.map(async (cliente) => {
      try {
        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: cliente.phone, name: cliente.fullName },
            assistantId: config.assistantId,
            phoneNumberId: activePhoneNumberId,
            metadata: { company: company },
          },
          {
            headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
          },
        );
        console.log(
          `✅ Llamada exitosa a ${cliente.fullName} (${cliente.phone}). ID: ${response.data.id}`,
        );
        return response.data;
      } catch (error) {
        console.error(
          `❌ Error llamando a ${cliente.fullName}:`,
          error.response?.data || error.message,
        );
        throw error; // Lanza para que Promise.all sepa que algo falló
      }
    });

    await Promise.all(calls);

    res.status(200).json({
      success: true,
      message: `Campaña iniciada para ${clientes.length} clientes de ${company}`,
    });
  } catch (e) {
    console.error("🔥 Error crítico en makeSmartCall:", e.message);
    res.status(500).json({ error: e.message });
  }
};
