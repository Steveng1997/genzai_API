const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId } = req.body;
    const files = req.files || [];

    if (!businessId)
      return res
        .status(400)
        .json({ success: false, message: "Falta email/businessId" });

    // 1. Buscar el nombre de la empresa en Payments (como en tu captura)
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
        : "Negocio Genzai";

    // 2. Subir archivos a OpenAI
    let fileIds = [];
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente GPT-4o (Soporta Visión y Excel)
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, el asistente de ventas de ${businessName}. Tu objetivo es contactar clientes y ofrecer promociones basadas en los archivos y datos proporcionados. Sé amable y profesional.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
      tool_resources: {
        file_search: { vector_stores: [] }, // Opcional: podrías crear un vector store persistente
      },
    });

    // 4. Guardar en AIConfigs para que CallController sepa qué ID usar
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId.toLowerCase().trim(),
          assistantId: assistant.id,
          businessName: businessName,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({
        success: true,
        message: "Riley configurada con éxito",
        assistantId: assistant.id,
      });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.askRiley = async (req, res) => {
  // Lógica para procesar mensajes directos si deseas chatear con ella en la app
  res
    .status(200)
    .json({
      success: true,
      response: "Recibido. Aplicaré esta instrucción en las llamadas.",
    });
};
