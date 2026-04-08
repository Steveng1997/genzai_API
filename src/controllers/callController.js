const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;
  console.log(
    `\n[${new Date().toISOString()}] --- INICIO PROCESO DE LLAMADA: ${company} ---`,
  );

  try {
    if (!company) {
      console.error("❌ Error: Compañía no proporcionada");
      return res.status(400).json({ message: "Compañía requerida" });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: company },
      }),
    );

    if (!config) {
      console.error(`❌ Error: No se encontró configuración para ${company}`);
      return res.status(404).json({ message: "No hay IA configurada" });
    }

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    const clientesParaLlamar = (clientes || []).filter(
      (c) => c.call_active === true,
    );

    console.log(
      `📊 Total: ${clientes?.length || 0} | Activos: ${clientesParaLlamar.length}`,
    );

    if (clientesParaLlamar.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes activos para llamar" });
    }

    const calls = clientesParaLlamar.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        console.log(`📞 Marcando -> ${cliente.fullName} (${formattedPhone})`);

        // Estructura optimizada para Vapi
        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: formattedPhone, name: cliente.fullName },
            assistantId: config.assistantId,
            assistantOverrides: {
              model: {
                provider: "openai",
                model: "gpt-4o",
                // Si config.openaiFileIds tiene datos, se pasan aquí.
                // Si el error persiste, Vapi prefiere que los archivos ya estén en el AssistantId configurado.
                messages: [
                  {
                    role: "system",
                    content: `Estás hablando con ${cliente.fullName}.`,
                  },
                ],
              },
            },
            phoneNumberId:
              config.vapiPhoneNumberId ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
            metadata: { company },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        console.log(
          `✅ Llamada aceptada para ${cliente.fullName}. ID: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ Error Vapi (${cliente.fullName}):`,
          err.response?.data || err.message,
        );
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    console.log(`--- FIN PROCESO: ${company} ---\n`);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 ERROR CRÍTICO:", e);
    res.status(500).json({ error: e.message });
  }
};
