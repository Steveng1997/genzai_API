const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const customerPhone = req.body.phone;

    if (!email || !customerPhone) {
      return res
        .status(400)
        .json({ success: false, message: "Faltan datos: email o phone" });
    }

    // 1. Buscar configuración
    const allConfigs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const config = allConfigs.Items.find(
      (item) => (item.ownerEmail || "").toLowerCase().trim() === email,
    );

    if (!config || !config.assistantId) {
      return res
        .status(404)
        .json({
          success: false,
          message: "IA no encontrada para este usuario",
        });
    }

    // 2. Llamar a VAPI
    const vapiResponse = await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: { number: customerPhone },
        assistantId: config.assistantId,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    res.status(200).json({
      success: true,
      message: "Llamada enviada a VAPI",
      callId: vapiResponse.data.id,
    });
  } catch (error) {
    console.error(
      "Error en makeSmartCall:",
      error.response?.data || error.message,
    );
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { makeSmartCall };
