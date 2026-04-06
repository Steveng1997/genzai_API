const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const { businessId } = req.body;
    const files = req.files;

    if (!email || !businessId)
      return res.status(400).json({ message: "Email y BusinessId requeridos" });

    // 1. Buscar suscripción
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: "Payments" }),
    );
    const business = allPayments.Items.find(
      (i) => i.email.toLowerCase() === email,
    );

    if (!business)
      return res.status(404).json({ message: "Suscripción no encontrada" });

    // 2. Simulación de procesamiento de archivos (Punto 1)
    if (files && files.length > 0) {
      files.forEach((file) => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }

    const product = business.sellingProduct || "General";

    // 3. Crear Asistente dinámico (Punto 3)
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${business.company}`,
      instructions: `Eres Riley, la asistente experta de ${business.company}, especialistas en ${product}.`,
      model: "gpt-4o",
    });

    // 4. Guardar Configuración (Punto 2, 3 y 5)
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: businessId,
          ownerEmail: email,
          assistantId: "4c266662-68db-4046-a13f-8c021c84919c", // ID de Vapi
          openaiAssistantId: assistant.id,
          businessName: product,
          vapiPhoneNumberId: "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          paymentId: business.paymentId || "N/A",
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: "Riley configurada correctamente" });
  } catch (e) {
    res.status(500).json({ message: "Error en setup", error: e.message });
  }
};
