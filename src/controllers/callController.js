const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ message: "Email requerido" });

    // 1. Obtener configuración de la IA
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: "AIConfigs" }),
    );
    const userConfig = configs.Items.find((i) => i.ownerEmail === email);

    const assistantId = "4c266662-68db-4046-a13f-8c021c84919c";
    const phoneId = "59d1cef7-80b8-4dfa-9a14-1394df3bc97a";

    // 2. Obtener Leads
    const leads = await dynamoDB.send(new ScanCommand({ TableName: "Leads" }));
    const clients = leads.Items || [];

    for (const client of clients) {
      if (client.phone) {
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) cleanPhone = `+57${cleanPhone}`;

        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: cleanPhone },
            assistantId: assistantId,
            phoneNumberId: phoneId,
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );
      }
    }
    res.status(200).json({ success: true, message: "Llamadas iniciadas" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
};
