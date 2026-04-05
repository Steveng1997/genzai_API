const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email requerido" });

    // 1. Obtener configuración del asistente
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    // 2. Extraer el nombre del producto (auto)
    const productToSay = userConfig?.businessName || "nuestro producto";
    const finalAssistantId =
      userConfig?.assistantId || "4c266662-68db-4046-a13f-8c02829288e9";

    // 3. Obtener clientes
    const clientsData = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_LEADS }),
    );
    const clients = clientsData.Items || [];

    const results = [];
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
              phoneNumberId: "59d1cef7-80b8-4dfa-9a14-13943f114660",
              // ESTO ES LO QUE HACE QUE DIGA "AUTO"
              assistantOverrides: {
                variableValues: {
                  businessName: productToSay,
                },
              },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );
          results.push({ phone: cleanPhone, status: "success" });
        } catch (err) {
          results.push({ phone: cleanPhone, status: "failed" });
        }
      }
    }

    res
      .status(200)
      .json({
        success: true,
        message: `Llamando para vender: ${productToSay}`,
      });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
