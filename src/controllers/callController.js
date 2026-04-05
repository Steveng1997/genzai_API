const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

exports.makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();

    // 1. Cargar configuración de Riley desde DynamoDB
    const configs = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_AI }),
    );
    const userConfig = configs.Items.find(
      (i) => (i.ownerEmail || "").toLowerCase() === email,
    );

    const productToSay = userConfig?.businessName || "autos";
    const finalAssistantId =
      userConfig?.assistantId || "4c266662-68db-4046-a13f-8c02829288e9";

    // USAMOS LA NUEVA VARIABLE DE ENTORNO
    const phoneId =
      process.env.VAPI_PHONE_NUMBER_ID ||
      "59d1cef7-80b8-4dfa-9a14-13943f114660";

    // 2. Obtener lista de clientes
    const clientsData = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_LEADS }),
    );
    const clients = clientsData.Items || [];

    console.log(`🚀 Iniciando campaña con PhoneID: ${phoneId}`);

    for (const client of clients) {
      if (client.phone) {
        let cleanPhone = client.phone.toString().replace(/\D/g, "");
        if (cleanPhone.length === 10) cleanPhone = `+57${cleanPhone}`;
        else if (!cleanPhone.startsWith("+")) cleanPhone = `+${cleanPhone}`;

        try {
          const response = await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: cleanPhone },
              assistantId: finalAssistantId,
              phoneNumberId: phoneId, // <--- ID DINÁMICO CORREGIDO
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
          console.log(
            `📞 Llamada aceptada para ${cleanPhone}. ID: ${response.data.id}`,
          );
        } catch (err) {
          console.error(
            `❌ Error en Vapi para ${cleanPhone}:`,
            err.response?.data || err.message,
          );
        }
      }
    }

    res
      .status(200)
      .json({ success: true, message: `Venta de ${productToSay} en marcha.` });
  } catch (e) {
    console.error("💥 Error en el proceso:", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};
