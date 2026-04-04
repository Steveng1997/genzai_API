const OpenAI = require("openai");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId, businessName } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No se recibieron archivos." });
    }

    const fileIds = [];

    // 1. Subir archivos a OpenAI
    for (const file of files) {
      // Usamos el path que Multer generó en la carpeta 'uploads'
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });

      fileIds.push(response.id);

      // Borrar archivo temporal después de subirlo a OpenAI
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    // 2. Crear el Asistente con File Search
    // Nota: Para mejores resultados, OpenAI recomienda crear un Vector Store primero,
    // pero esta forma directa también funciona.
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, la experta en ventas de ${businessName}. Tu conocimiento se basa en los documentos cargados.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o", // O gpt-4-turbo
      tool_resources: {
        file_search: {
          vector_stores: [
            {
              file_ids: fileIds,
            },
          ],
        },
      },
    });

    // 3. Guardar en DynamoDB (IMPORTANTE para la función de llamada posterior)
    const bId = businessId.toLowerCase().trim();

    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: bId,
          assistantId: assistant.id, // Este es el ID que busca el callController
          businessName: businessName,
          fileIds: fileIds,
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      assistantId: assistant.id,
      message: "Riley configurada con éxito",
    });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    // Limpieza de archivos si hubo error
    if (req.files) {
      req.files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};
