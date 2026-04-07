const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;
  console.log(`\n--- INICIO DE CAMPAÑA: ${company} ---`);

  try {
    if (!company) {
      return res.status(400).json({ message: "Compañía requerida" });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: company },
      }),
    );

    if (!config) {
      console.log(`❌ Configuración no encontrada para ${company}`);
      return res.status(404).json({ message: "No hay IA configurada" });
    }

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: "Clients",
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    if (!clientes || clientes.length === 0) {
      console.log(`⚠️ No hay clientes para la empresa ${company}`);
      return res.status(404).json({ message: "No hay clientes" });
    }

    const calls = clientes.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        console.log(`>> Intentando: ${cliente.fullName} -> ${formattedPhone}`);

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: cliente.fullName,
            },
            assistantId: config.assistantId,
            phoneNumberId:
              config.vapiPhoneNumberId ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
            metadata: { company: company },
          },
          {
            headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
          },
        );

        console.log(
          `✅ Éxito cliente ${cliente.fullName}: ID ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ Fallo cliente ${cliente.fullName}:`,
          err.response?.data || err.message,
        );
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    console.log(`--- FIN DE PROCESO PARA ${company} ---\n`);

    res.status(200).json({
      success: true,
      message: `Proceso terminado para ${clientes.length} clientes en ${company}`,
      results,
    });
  } catch (e) {
    console.error("🔥 Error crítico:", e);
    res.status(500).json({ error: e.message });
  }
};
