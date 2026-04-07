const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { company } = req.body;
    if (!company)
      return res
        .status(400)
        .json({ message: "ID de empresa no proporcionado" });

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: company },
      }),
    );

    if (!config)
      return res
        .status(404)
        .json({ message: "No hay IA configurada para " + company });

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: "Clients",
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    if (!clientes || clientes.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes registrados para " + company });
    }

    const calls = clientes.map((cliente) => {
      return axios.post(
        "https://api.vapi.ai/call/phone",
        {
          customer: { number: cliente.phone, name: cliente.fullName },
          assistantId: config.assistantId,
          phoneNumberId: "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          metadata: { company: company },
        },
        {
          headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
        },
      );
    });

    await Promise.all(calls);
    res
      .status(200)
      .json({
        success: true,
        message: `Campaña iniciada para ${clientes.length} clientes de ${company}`,
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
