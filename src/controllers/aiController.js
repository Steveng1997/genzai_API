const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    // Con Multer, req.body ya no llegará vacío
    const email = (req.body.email || "").toLowerCase().trim();
    const files = req.files; // Aquí están tus PDF, Excel, etc.

    if (!email) return res.status(400).json({ message: "Email requerido" });

    // 1. Buscar suscripción del usuario
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: "Payments" }),
    );
    const business = allPayments.Items.find((i) => i.email === email);

    if (!business)
      return res.status(404).json({ message: "Suscripción no encontrada" });

    // 2. Opcional: Subir archivos a OpenAI para entrenamiento real
    // Por ahora, solo confirmamos recepción y limpiamos temporales
    if (files && files.length > 0) {
      files.forEach((file) => {
        console.log(`Archivo recibido: ${file.originalname}`);
        fs.unlinkSync(file.path); // Borra el archivo temporal del server
      });
    }

    const product = business.sellingProduct || "autos";

    // 3. Actualizar configuración en DynamoDB
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: business.company.toLowerCase().replace(/ /g, "_"),
          ownerEmail: email,
          assistantId: "4c266662-68db-4046-a13f-8c021c84919c",
          businessName: product,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley entrenada con éxito" });
  } catch (e) {
    console.error("Error en AI Setup:", e.message);
    res
      .status(500)
      .json({ message: "Error al procesar archivos", error: e.message });
  }
};