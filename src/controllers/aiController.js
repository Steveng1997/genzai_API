const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { businessId } = req.body; // El email del usuario
    const files = req.files;

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No se subieron archivos." });
    }

    // 1. Buscar el nombre de la empresa en la tabla Payments
    const paymentsData = await dynamoDB.send(
      new ScanCommand({
        TableName: "Payments",
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": businessId.toLowerCase().trim() },
      }),
    );

    // Extraemos el campo 'company' de la captura de pantalla que enviaste
    const businessName =
      paymentsData.Items?.length > 0
        ? paymentsData.Items[0].company
        : "Negocio Genzai";

    const fileIds = [];
    // 2. Subir archivos a OpenAI (Usando el path temporal de Multer)
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);

      // Borrar archivo temporal del servidor
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente vinculado a los archivos
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${businessName}`,
      instructions: `Eres Riley, el asistente virtual de ${businessName}. Usa solo los documentos cargados.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
      tool_resources: {
        file_search: { vector_stores: [{ file_ids: fileIds }] },
      },
    });

    // 4. Guardar configuración final en AIConfigs
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId.toLowerCase().trim(),
          businessName: businessName,
          assistantId: assistant.id,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley configurada con éxito" });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
