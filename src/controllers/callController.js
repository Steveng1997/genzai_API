const axios = require("axios");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId, clientId } = req.body;

    // 1. Buscamos al cliente en tu tabla de Dynamo para sacar su celular
    const clientData = await dynamoDB.send(
      new GetCommand({
        TableName: "Clients",
        Key: { businessId: businessId, clientId: clientId },
      }),
    );

    if (!clientData.Item || !clientData.Item.phone) {
      return res
        .status(404)
        .json({ message: "Cliente o teléfono no encontrado" });
    }

    // 2. Traemos la config de Riley (el assistantId que creaste al subir los PDFs)
    const config = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config.Item) {
      return res
        .status(404)
        .json({ message: "Riley no está configurado para este negocio" });
    }

    // 3. Disparamos la llamada en Vapi
    const vapiResponse = await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: { number: clientData.Item.phone },
        assistantId: config.Item.assistantId,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // El ID del número que compraste en Vapi
      },
      {
        headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      },
    );

    res.status(200).json({
      success: true,
      message: "Llamada iniciada",
      callId: vapiResponse.data.id,
    });
  } catch (error) {
    console.error("Error en Vapi:", error.response?.data || error.message);
    res.status(500).json({ error: "Error al conectar con Vapi" });
  }
};
