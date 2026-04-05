const axios = require("axios");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const makeSmartCall = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Teléfono requerido" });

    // 1. Buscar cliente en DynamoDB (Partition Key: phone como Número)
    const clientRes = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { phone: Number(phone) },
      }),
    );

    if (!clientRes.Item)
      return res.status(404).json({ message: "Cliente no encontrado" });

    const client = clientRes.Item;
    // Usamos el campo sellingProduct (ej: "Autos") para identificar la IA
    const category = client.sellingProduct;

    // 2. Buscar la Riley configurada para ese producto en AIConfigs
    const aiConfig = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: category },
      }),
    );

    if (!aiConfig.Item)
      return res
        .status(404)
        .json({ message: `No hay IA configurada para ${category}` });

    // 3. Disparar llamada vía Vapi
    await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: {
          number: client.phone.toString(),
          name: client.fullName,
        },
        assistantId: aiConfig.Item.assistantId,
      },
      {
        headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      },
    );

    res
      .status(200)
      .json({ success: true, message: "Llamada enviada con Riley" });
  } catch (error) {
    console.error("Error en makeSmartCall:", error);
    res.status(500).json({ message: error.message });
  }
};

// EXPORTACIÓN COMPLETA
module.exports = {
  makeSmartCall,
};
