const OpenAI = require("openai");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId, businessName } = req.body; // businessId es el email
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No se subieron archivos." });
    }

    // 1. Subir archivos a OpenAI
    const fileIds = [];
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);
      // Borrado seguro del archivo temporal
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 2. Crear Vector Store y Asistente
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, el asistente virtual oficial de ${businessName}. 
      Tu conocimiento proviene exclusivamente de los documentos cargados. 
      Responde de forma amable y profesional.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4-turbo",
      tool_resources: {
        file_search: { vector_stores: [{ file_ids: fileIds }] },
      },
    });

    // 3. Guardar configuración en DynamoDB (Tabla AIConfigs)
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId.toLowerCase().trim(),
          businessName: businessName,
          assistantId: assistant.id,
          fileIds: fileIds,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      assistantId: assistant.id,
      message: "Riley configurado y vinculado con éxito",
    });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ error: error.message });
  }
};
