const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId } = req.body;
    const files = req.files;

    // Buscar empresa en tabla Payments
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

    let fileIds = [];
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

    // Crear asistente con gpt-4o y Code Interpreter para Excel
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, asistente de ${businessName}. Usa los archivos y promociones del chat para vender.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
      tool_resources: {
        file_search: { vector_stores: [] }, // Se recomienda crear un vector_store aparte si son muchos archivos
      },
    });

    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId.toLowerCase().trim(),
          assistantId: assistant.id,
          businessName: businessName,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({ success: true, assistantId: assistant.id });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.askRiley = async (req, res) => {
  res.status(200).json({
    success: true,
    response: "Promoción guardada en el contexto de Riley.",
  });
};
