const axios = require("axios");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { phone } = req.body;

    // 1. Buscar cliente por teléfono (Partition Key: phone de tipo Número)
    const clientRes = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { phone: Number(phone) },
      }),
    );

    if (!clientRes.Item)
      return res.status(404).json({ message: "Cliente no encontrado" });

    const client = clientRes.Item;
    // Buscamos el nicho asignado al cliente en su registro
    const category = client.sellingProduct || "Autos";

    // 2. Obtener la Riley configurada para ese nicho
    const aiConfig = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: category },
      }),
    );

    if (!aiConfig.Item)
      return res.status(404).json({ message: `No hay IA para ${category}` });

    // 3. Lanzar llamada mediante Vapi
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

    res.status(200).json({ success: true, message: "Llamada enviada" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.vapiWebhook = (req, res) => res.status(200).send("OK");
