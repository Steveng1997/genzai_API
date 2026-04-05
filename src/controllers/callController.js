const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const axios = require("axios");

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2",
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Escaneamos la tabla de clientes desde las variables de entorno
    const params = {
      TableName: process.env.DYNAMODB_TABLE_LEADS,
    };

    const { Items } = await ddbDocClient.send(new ScanCommand(params));

    if (!Items || Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hay clientes en la tabla para iniciar la campaña.",
      });
    }

    // --- CONFIGURACIÓN DE VAPI (Extraídas de variables de entorno) ---
    const VAPI_API_KEY = process.env.VAPI_API_KEY;
    const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

    console.log(`🚀 Iniciando campaña masiva para ${Items.length} clientes...`);

    // 2. Procesamos las llamadas usando un bucle robusto
    // Usamos for...of para que el proceso sea ordenado y maneje bien las esperas
    for (const cliente of Items) {
      let rawPhone = cliente.phone.toString();
      const nombre = cliente.fullName || "Cliente";

      let formattedPhone = rawPhone.replace(/\D/g, "");

      if (formattedPhone.length === 10) {
        formattedPhone = "57" + formattedPhone;
      }

      if (!formattedPhone.startsWith("+")) {
        formattedPhone = "+" + formattedPhone;
      }

      try {
        console.log(
          `📡 Enviando solicitud a Vapi: ${nombre} (${formattedPhone})`,
        );

        // INTEGRACIÓN REAL CON VAPI API
        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: nombre,
            },
            assistantId: VAPI_ASSISTANT_ID,
          },
          {
            headers: {
              Authorization: `Bearer ${VAPI_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );

        console.log(`✅ Solicitud aceptada por Vapi para: ${nombre}`);
      } catch (err) {
        // Log detallado del error de Vapi para debugging
        console.error(
          `❌ Falló llamada a ${formattedPhone}:`,
          err.response?.data || err.message,
        );
      }
    }

    // 3. Respuesta final al App
    return res.status(200).json({
      success: true,
      message: `Proceso de campaña finalizado para ${Items.length} clientes.`,
    });
  } catch (error) {
    console.error("❌ Error en Campaña Masiva:", error);
    res.status(500).json({
      success: false,
      message: "Error crítico al procesar la campaña masiva.",
    });
  }
};
