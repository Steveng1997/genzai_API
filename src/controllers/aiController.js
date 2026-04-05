const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res.status(400).json({ success: false, message: "Falta email" });

    // 1. Buscar empresa en DynamoDB
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_PAYMENTS }),
    );
    const business = allPayments.Items.find(
      (item) => (item.email || "").toLowerCase().trim() === email,
    );

    if (!business)
      return res
        .status(404)
        .json({ success: false, message: "Suscripción no encontrada" });

    // 2. Subir archivos a OpenAI
    let fileIds = [];
    if (req.files) {
      for (const file of req.files) {
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        fileIds.push(response.id);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    // 3. Crear Asistente en OpenAI
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${business.company}`,
      instructions: `Eres Riley, asistente de ${business.company}. Usa los documentos para responder.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    // 4. Guardar configuración vinculada al email
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
        Item: {
          ownerEmail: email,
          assistantId: assistant.id,
          businessName: business.company,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley entrenada con éxito" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { setupAssistant };
