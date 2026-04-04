const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId } = req.body;
    const files = req.files;

    // 1. Obtener nombre de la empresa desde Payments
    const paymentsData = await dynamoDB.send(
      new ScanCommand({
        TableName: "Payments",
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": businessId.toLowerCase().trim() },
      }),
    );

    const businessName =
      paymentsData.Items && paymentsData.Items.length > 0
        ? paymentsData.Items[0].company
        : "Genzai Business";

    let fileIds = [];

    // 2. Procesar archivos (PDF, Imágenes, Excel)
    if (files && files.length > 0) {
      for (const file of files) {
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        fileIds.push(response.id);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    // 3. Crear el Asistente con capacidades de Visión y Análisis de Datos
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, el asistente de ventas de ${businessName}. 
      Tu conocimiento base viene de los archivos subidos (listas de precios, volantes, catálogos).
      También debes estar atento a las promociones temporales que el usuario te escriba por chat.`,
      tools: [
        { type: "file_search" }, // Para PDFs y documentos largos
        { type: "code_interpreter" }, // Para leer archivos EXCEL (.xlsx)
      ],
      model: "gpt-4o", // Soporta JPG, PNG y lógica avanzada
      tool_resources: {
        file_search: {
          vector_stores: fileIds.length > 0 ? [{ file_ids: fileIds }] : [],
        },
      },
    });

    // 4. Guardar configuración en AIConfigs
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId.toLowerCase().trim(),
          businessName: businessName,
          assistantId: assistant.id,
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley configurada correctamente" });
  } catch (error) {
    console.error("Error AI Setup:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Controlador para procesar las promociones escritas por chat
exports.askRiley = async (req, res) => {
  try {
    const { businessId, message } = req.body;
    // Aquí implementarías la lógica de threads de OpenAI para mantener la memoria
    // Por ahora, Riley responde basándose en el mensaje actual
    res
      .status(200)
      .json({
        success: true,
        response:
          "Entendido, recordaré esta promoción para las siguientes llamadas.",
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
