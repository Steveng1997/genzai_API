const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
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

    if (!businessId) {
      return res
        .status(400)
        .json({ success: false, message: "businessId es requerido" });
    }

    // 1. OBTENER CONFIGURACIÓN DE LA IA (Assistant ID)
    // Buscamos en la tabla AIConfigs usando el businessId (genzai)
    const aiConfigParams = {
      TableName: process.env.DYNAMODB_TABLE_AI || "AIConfigs",
      Key: { businessId: businessId },
    };

    const { Item: aiConfig } = await ddbDocClient.send(
      new GetCommand(aiConfigParams),
    );

    if (!aiConfig || !aiConfig.assistantId) {
      console.error(
        `❌ No se encontró assistantId para el negocio: ${businessId}`,
      );
      return res
        .status(404)
        .json({
          success: false,
          message: "Configuración de IA no encontrada para este negocio.",
        });
    }

    const VAPI_ASSISTANT_ID = aiConfig.assistantId;
    const VAPI_API_KEY = process.env.VAPI_API_KEY;

    // 2. OBTENER LISTA DE CLIENTES
    const clientParams = {
      TableName: process.env.DYNAMODB_TABLE_LEADS || "Clients",
    };
    const { Items: clientes } = await ddbDocClient.send(
      new ScanCommand(clientParams),
    );

    if (!clientes || clientes.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No hay clientes en la tabla." });
    }

    console.log(
      `🚀 Iniciando campaña para ${businessId} usando Assistant: ${VAPI_ASSISTANT_ID}`,
    );

    // 3. DISPARAR LLAMADAS
    for (const cliente of clientes) {
      let rawPhone = cliente.phone.toString();

      // Formateo E.164
      let formattedPhone = rawPhone.replace(/\D/g, "");
      if (formattedPhone.length === 10) formattedPhone = "57" + formattedPhone;
      if (!formattedPhone.startsWith("+"))
        formattedPhone = "+" + formattedPhone;

      try {
        await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: cliente.fullName || "Cliente",
            },
            assistantId: VAPI_ASSISTANT_ID,
            phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
          },
          {
            headers: {
              Authorization: `Bearer ${VAPI_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );
        console.log(
          `✅ Llamada aceptada: ${cliente.fullName} (${formattedPhone})`,
        );
      } catch (err) {
        console.error(
          `❌ Error en Vapi para ${formattedPhone}:`,
          err.response?.data || err.message,
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: `Campaña procesada para ${clientes.length} clientes.`,
    });
  } catch (error) {
    console.error("❌ Error Crítico:", error);
    res
      .status(500)
      .json({ success: false, message: "Error interno del servidor." });
  }
};
