const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { email } = req.body;
    const files = req.files || [];

    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email es requerido" });

    // 1. Buscar el producto (nicho) en Payments
    const paymentsData = await dynamoDB.send(
      new ScanCommand({
        TableName: "Payments",
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email.toLowerCase().trim() },
      }),
    );

    if (!paymentsData.Items || paymentsData.Items.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No se encontró suscripción" });
    }

    const sub = paymentsData.Items[0];
    const productKey = sub.sellingProduct; // Ejemplo: "Autos"
    const company = sub.company;

    // 2. Subir archivos a OpenAI v6
    let fileIds = [];
    for (const file of files) {
      const fileStream = fs.createReadStream(file.path);
      const openAiFile = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      fileIds.push(openAiFile.id);

      // Limpiar archivo temporal
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente con contexto de producto
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${productKey}`,
      instructions: `Eres Riley, experta en ventas de ${productKey} para la empresa ${company}. Usa los archivos adjuntos para cerrar ventas.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs usando el producto como ID
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: productKey, // Clave: Autos, Ropa, etc.
          assistantId: assistant.id,
          businessName: company,
          category: productKey,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: `Riley configurada para ${productKey}` });
  } catch (error) {
    console.error("Error Setup:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.askRiley = (req, res) => res.status(200).json({ success: true });
