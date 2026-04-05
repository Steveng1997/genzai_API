const axios = require("axios");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone)
      return res
        .status(400)
        .json({ message: "Teléfono del cliente requerido" });

    // 1. Obtener datos del cliente (Partition Key: phone como Número)
    const clientRes = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { phone: Number(phone) },
      }),
    );

    if (!clientRes.Item)
      return res
        .status(404)
        .json({ message: "Cliente no encontrado en la base de datos" });

    const client = clientRes.Item;
    // El cliente debe tener asignado qué producto le interesa
    const productCategory = client.sellingProduct;

    // 2. Buscar la configuración de la IA para ese producto específico
    const aiConfig = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: productCategory },
      }),
    );

    if (!aiConfig.Item) {
      return res
        .status(404)
        .json({
          message: `No hay una Riley configurada para el nicho: ${productCategory}`,
        });
    }

    // 3. Disparar llamada con Vapi usando el AssistantId dinámico
    await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: {
          number: client.phone.toString(),
          name: client.fullName || "Cliente",
        },
        assistantId: aiConfig.Item.assistantId,
      },
      {
        headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      },
    );

    res
      .status(200)
      .json({ success: true, message: "Campaña iniciada para este cliente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
