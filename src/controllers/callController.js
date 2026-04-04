const axios = require("axios");
const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { phone } = req.body; // Ahora buscamos por teléfono del cliente

    // 1. Buscar al cliente en la tabla Clients por su phone (Partition Key)
    const clientData = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { phone: Number(phone) }, // En tu captura el phone es Número
      }),
    );

    if (!clientData.Item) {
      return res
        .status(404)
        .json({ success: false, message: "Cliente no encontrado" });
    }

    const client = clientData.Item;
    // Asumimos que en la tabla Clients guardas a qué categoría pertenece (ej: "Autos")
    const category = client.interestCategory || "Autos";

    // 2. Buscar la configuración de Riley para esa categoría (Autos, Ropa, etc)
    const aiConfig = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: category },
      }),
    );

    if (!aiConfig.Item) {
      return res
        .status(404)
        .json({
          success: false,
          message: `No hay una IA configurada para ${category}`,
        });
    }

    // 3. Ejecutar llamada con el asistente específico del nicho
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
      .json({ success: true, message: `Llamada de ${category} iniciada` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
