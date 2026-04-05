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

    // IDS CORREGIDOS SEGÚN TUS CAPTURAS
    const finalAssistantId = "4c266662-68db-4046-a13f-8c021c84919c";
    const phoneId = "59d1cef7-80b8-4dfa-9a14-1394df3bc97a";
    const productToSay = userConfig?.businessName || "autos";

    const clientsData = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_LEADS }),
    );
    const clients = clientsData.Items || [];

    for (const client of clients) {
      if (client.phone) {
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) cleanPhone = `+57${cleanPhone}`;
        else if (!cleanPhone.startsWith("+")) cleanPhone = `+${cleanPhone}`;

        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: finalAssistantId,
              phoneNumberId: phoneId,
              assistantOverrides: {
                variableValues: { businessName: productToSay },
              },
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
            `❌ Error enviando llamada a ${cleanPhone}:`,
            err.response?.data || err.message,
          );
        }
      }
    }
    res.status(200).json({
      success: true,
      message: `Campaña para ${productToSay} iniciada`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};
