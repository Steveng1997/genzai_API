const axios = require("axios");
const { QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Obtener el AssistantId de la tabla que acabamos de llenar
    const config = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId.toLowerCase().trim() },
      }),
    );

    if (!config.Item?.assistantId) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Riley no configurada para este negocio.",
        });
    }

    // 2. Buscar clientes habilitados (isEnabled = true)
    const clientsData = await dynamoDB.send(
      new QueryCommand({
        TableName: "Clients",
        KeyConditionExpression: "businessId = :bid",
        FilterExpression: "isEnabled = :checked",
        ExpressionAttributeValues: { ":bid": businessId, ":checked": true },
      }),
    );

    const activeClients = clientsData.Items || [];
    if (activeClients.length === 0)
      return res
        .status(200)
        .json({ success: false, message: "No hay clientes seleccionados." });

    // 3. Ejecutar llamadas
    let count = 0;
    for (const client of activeClients) {
      const phone = client.Celular || client.phone;
      if (phone) {
        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: phone, name: client.nombre || "Cliente" },
            assistantId: config.Item.assistantId,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
            },
          },
        );
        count++;
      }
    }

    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
