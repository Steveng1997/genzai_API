const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const files = req.files; // Aquí llegan los archivos gracias a multer

    if (!email) return res.status(400).json({ message: "Email faltante" });

    // 1. Buscar suscripción
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_PAYMENTS }),
    );
    const business = allPayments.Items.find((i) => i.email === email);
    if (!business) return res.status(404).json({ message: "Sin suscripción" });

    const product = business.sellingProduct || "autos";
    let fileIds = [];

    // 2. Subir archivos a OpenAI si existen
    if (files && files.length > 0) {
      for (const file of files) {
        const uploadedFile = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        fileIds.push(uploadedFile.id);
        fs.unlinkSync(file.path); // Borrar archivo temporal del servidor
      }
    }

    // 3. Crear Asistente con File Search (para PDF/Excel)
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${product}`,
      instructions: `Eres la asistente experta en ventas de ${product}. Usa los archivos adjuntos para responder.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
      tool_resources:
        fileIds.length > 0
          ? {
              file_search: { vector_store_ids: [] }, // Opcional: podrías crear un vector store aquí
            }
          : {},
    });

    // 4. Guardar en DynamoDB
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
        Item: {
          businessId: business.company.toLowerCase().replace(/ /g, "_"),
          ownerEmail: email,
          assistantId: "4c266662-68db-4046-a13f-8c021c84919c",
          openaiAssistantId: assistant.id,
          businessName: product,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Asistente entrenado con éxito" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
};
