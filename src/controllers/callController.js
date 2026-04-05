const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email || !phone)
      return res.status(400).json({ message: "Faltan datos" });

    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find(
      (i) => i.ownerEmail === email.toLowerCase().trim(),
    );

    if (!userConfig)
      return res.status(404).json({ message: "IA no entrenada" });

    const vapiRes = await axios.post(
      "https://api.vapi.ai/call/phone",
      {
        customer: { number: phone },
        assistantId: userConfig.assistantId,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      },
      {
        headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      },
    );

    res.status(200).json({ success: true, id: vapiRes.data.id });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
