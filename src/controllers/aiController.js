const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuración de tablas desde variables de entorno
const TABLE_PAYMENTS = process.env.DYNAMODB_TABLE_PAYMENTS || "Payments";
const TABLE_AI_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const { company } = req.body; // Usamos la compañía como identificador
    const files = req.files;

    // Validación de entrada
    if (!email || !company) {
      return res.status(400).json({
        message: "Faltan datos obligatorios: email y company son necesarios.",
      });
    }

    // 1. Buscar la suscripción/pago del usuario para obtener el producto que vende
    const paymentsResponse = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_PAYMENTS,
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email },
      }),
    );

    const businessData = paymentsResponse.Items && paymentsResponse.Items[0];

    if (!businessData) {
      return res.status(404).json({
        message:
          "No se encontró un registro de pago para este correo. Verifica la suscripción.",
      });
    }

    // 2. Limpieza de archivos temporales (se eliminan después de la lógica)
    if (files && files.length > 0) {
      files.forEach((file) => {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (err) {
            console.error(
              `Error al borrar archivo temporal: ${file.path}`,
              err,
            );
          }
        }
      });
    }

    const productDescription =
      businessData.sellingProduct || "servicios generales";

    // 3. Crear el Asistente en OpenAI
    // Se usa el nombre de la compañía para personalizar a Riley
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company}`,
      instructions: `Eres Riley, la asistente experta de la empresa "${company}". 
      Tu especialidad es atender a clientes interesados en "${productDescription}". 
      Tu tono debe ser profesional, amable y siempre enfocado en ayudar al cliente.`,
      model: "gpt-4o",
    });

    // 4. Guardar la configuración final en la tabla AIConfigs
    const aiConfigItem = {
      businessId: company, // Identificador único de la compañía para filtrar Tasks y Clients
      ownerEmail: email,
      openaiAssistantId: assistant.id, // ID generado por OpenAI
      assistantId: "4c266662-68db-4046-a13f-8c021c84919c", // ID base de Vapi
      vapiPhoneNumberId:
        process.env.VAPI_PHONE_NUMBER_ID ||
        "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
      businessName: company,
      product: productDescription,
      paymentId: businessData.paymentId || "N/A",
      updatedAt: new Date().toISOString(),
      createdAt: businessData.paymentDate || new Date().toISOString(),
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_AI_CONFIGS,
        Item: aiConfigItem,
      }),
    );

    // Respuesta exitosa
    res.status(200).json({
      success: true,
      message: "Configuración de Riley completada con éxito.",
      data: {
        company: company,
        assistantId: assistant.id,
      },
    });
  } catch (e) {
    console.error("❌ Error en setupAssistant:", e);
    res.status(500).json({
      message: "Hubo un error al configurar el asistente virtual.",
      error: e.message,
    });
  }
};
