const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || req.body.userEmail || "")
      .toLowerCase()
      .trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email requerido" });

    // 1. Buscar suscripción en Payments
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: "Payments" }),
    );
    const business = allPayments.Items.find(
      (item) => (item.email || "").toLowerCase().trim() === email,
    );

    if (!business) {
      return res
        .status(404)
        .json({
          success: false,
          message: "No se encontró suscripción para este email",
        });
    }

    const category = business.sellingProduct || "General";
    const company = business.company || "Genzai Partner";

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

    // 3. Crear Asistente Riley
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company}`,
      instructions: `Eres Riley, asistente de ${company} en el sector ${category}. Usa tus archivos para responder.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: category, // Usado para identificar el contexto en la llamada
          assistantId: assistant.id,
          businessName: company,
          ownerEmail: email,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: `Riley configurada para ${category}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  setupAssistant,
  askRiley: async (req, res) => res.json({ ok: true }),
};
