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
      console.error("❌ Error: Compañía no proporcionada en el body");
      return res.status(400).json({ message: "Compañía requerida" });
    }

    console.log(
      `[DB] Buscando configuración en ${TABLE_CONFIGS} para: ${company}`,
    );
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
    console.log(`✅ Configuración cargada. AssistantId: ${config.assistantId}`);

    console.log(`[DB] Escaneando clientes para la empresa: ${company}`);
    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    console.log(`📊 Clientes totales encontrados: ${clientes?.length || 0}`);

    const clientesParaLlamar = (clientes || []).filter(
      (c) => c.call_active === true,
    );

    console.log(
      `🎯 Clientes con call_active=true: ${clientesParaLlamar.length}`,
    );

    if (clientesParaLlamar.length === 0) {
      console.warn("⚠️ No se procede: No hay clientes con estado activo.");
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

        console.log(
          `📞 Intentando POST Vapi -> ${cliente.fullName} (${formattedPhone})`,
        );

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: formattedPhone, name: cliente.fullName },
            assistantId: config.assistantId,
            assistantOverrides: {
              model: {
                knowledgeBase: {
                  provider: "openai",
                  fileIds: config.openaiFileIds || [],
                },
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
          `✅ Vapi aceptó la llamada para ${cliente.fullName}. CallId: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ Error en POST Vapi para ${cliente.fullName}:`,
          err.response?.data || err.message,
        );
        return {
          error: true,
          client: cliente.fullName,
          details: err.response?.data,
        };
      }
    });

    const results = await Promise.all(calls);
    console.log(`--- FIN DE PROCESO DE LLAMADA PARA ${company} ---\n`);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 ERROR CRÍTICO en makeSmartCall:", e);
    res.status(500).json({ error: e.message });
  }
};
