const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const files = req.files; // Aquí llegan gracias a multer

    if (!email) return res.status(400).json({ message: "Falta el email" });

    // 1. Verificar suscripción
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_PAYMENTS }),
    );
    const business = allPayments.Items.find((i) => i.email === email);
    if (!business) return res.status(404).json({ message: "Sin suscripción" });

    // 2. Subir archivos a OpenAI para que Riley los use
    let vectorStoreId = null;
    if (files && files.length > 0) {
      // Aquí podrías crear un vector store o subir archivos individuales
      // Por ahora, Riley usará gpt-4o con el producto:
      for (const file of files) {
        // Lógica de subida opcional a OpenAI...
        fs.unlinkSync(file.path); // Limpiar archivos temporales
      }
    }

    const product = business.sellingProduct || "autos";

    // 3. Crear Asistente
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${product}`,
      instructions: `Eres la asistente experta en ventas de ${product}.`,
      model: "gpt-4o",
    });

    // 4. Guardar Configuración
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

    res.status(200).json({ success: true, message: "Iniciando..." });
  } catch (e) {
    console.error("❌ Error Setup Assistant:", e.message);
    res.status(500).json({ message: e.message });
  }
};
