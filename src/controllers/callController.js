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
        .json({ success: false, message: "Email y teléfono requeridos" });
    }

    const allConfigs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const config = allConfigs.Items.find(
      (item) => (item.ownerEmail || "").toLowerCase().trim() === email,
    );

    if (!config || !config.assistantId) {
      return res
        .status(404)
        .json({ success: false, message: "IA no configurada" });
    }

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

    res.status(200).json({ success: true, callId: vapiResponse.data.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// CRÍTICO: Asegúrate de exportar la función así
module.exports = {
  makeSmartCall,
};
