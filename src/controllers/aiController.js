const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const files = req.files;

    if (!email) return res.status(400).json({ message: "Email requerido" });

    // 1. Buscar suscripción del usuario en la tabla de Pagos
    const allPayments = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.DYNAMODB_TABLE_PAYMENTS || "Payments",
      }),
    );
    const business = allPayments.Items.find((i) => i.email === email);

    if (!business)
      return res.status(404).json({ message: "Suscripción no encontrada" });

    // 2. Procesar archivos recibidos
    if (files && files.length > 0) {
      files.forEach((file) => {
        console.log(`📄 Archivo procesado: ${file.originalname}`);
        // Aquí podrías implementar la subida a OpenAI Vector Store
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }

    const product = business.sellingProduct || "autos";

    // 3. Crear Asistente en OpenAI
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${product}`,
      instructions: `Eres la asistente experta en ventas de ${product}.`,
      model: "gpt-4o",
    });

    // 4. Guardar configuración en la tabla de AI
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_AI || "AIConfigs",
        Item: {
          businessId: business.company.toLowerCase().replace(/ /g, "_"),
          ownerEmail: email,
          assistantId: "4c266662-68db-4046-a13f-8c021c84919c", // ID de Vapi
          openaiAssistantId: assistant.id,
          businessName: product,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley entrenada con éxito" });
  } catch (e) {
    console.error("❌ Error en AI Setup:", e.message);
    res
      .status(500)
      .json({ message: "Error al procesar archivos", error: e.message });
  }
};
