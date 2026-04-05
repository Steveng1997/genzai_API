const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const setupAssistant = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.businessId;
    if (!rawEmail)
      return res
        .status(400)
        .json({ success: false, message: "Email requerido" });

    const emailToSearch = rawEmail.toLowerCase().trim();

    // 1. Buscar en la tabla Payments
    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: "Payments" }),
    );
    const business = allPayments.Items.find(
      (item) => (item.email || "").toLowerCase().trim() === emailToSearch,
    );

    if (!business) {
      return res
        .status(404)
        .json({
          success: false,
          message: `No se encontró suscripción para ${emailToSearch}`,
        });
    }

    const category = business.sellingProduct || "General";
    const company = business.company || "Genzai";

    // 2. Subir archivos a OpenAI
    let fileIds = [];
    const files = req.files || [];
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company} (${category})`,
      instructions: `Eres Riley, la asistente experta de ${company} en el sector de ${category}.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    // 4. Guardar Configuración en DynamoDB
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: category,
          assistantId: assistant.id,
          businessName: company,
          ownerEmail: emailToSearch,
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

const askRiley = async (req, res) => {
  res.status(200).json({ success: true, message: "Endpoint de chat activo" });
};

// EXPORTACIÓN UNIFICADA (Soluciona el error de Undefined)
module.exports = {
  setupAssistant,
  askRiley,
};
