const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;
  try {
    if (!company)
      return res.status(400).json({ message: "Compañía requerida" });

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: company },
      }),
    );

    if (!config)
      return res.status(404).json({ message: "No hay IA configurada" });

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

    if (clientesParaLlamar.length === 0)
      return res.status(404).json({ message: "No hay clientes activos" });

    const calls = clientesParaLlamar.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

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
              config.vapiPhoneNumberId || process.env.VAPI_PHONE_NUMBER_ID,
            metadata: { company },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );
        return response.data;
      } catch (err) {
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
