const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find((i) => i.ownerEmail === email);

    // IDs de tus capturas
    const assistantId = "4c266662-68db-4046-a13f-8c021c84919c";
    const phoneId = "59d1cef7-80b8-4dfa-9a14-1394df3bc97a";
    const product = userConfig?.businessName || "autos";

    const leads = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_LEADS }),
    );
    const clients = leads.Items || [];

    for (const client of clients) {
      if (client.phone) {
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) cleanPhone = `+57${cleanPhone}`;

        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: assistantId,
              phoneNumberId: phoneId,
              assistantOverrides: { variableValues: { businessName: product } },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );
        } catch (err) {
          console.error(
            `❌ Error en llamada:`,
            err.response?.data || err.message,
          );
        }
      }
    }
    res.status(200).json({ success: true, message: "Llamadas en curso" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
