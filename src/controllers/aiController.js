const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Función para configurar al asistente
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
      if (fs.existsSync(file.path)) {
        const response = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        fileIds.push(response.id);
        fs.unlinkSync(file.path); // Limpiar archivo temporal
      }
    }

    // 3. Crear Asistente
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company} (${category})`,
      instructions: `Eres Riley, la asistente de ${company}. Tu sector es ${category}.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    // 4. Guardar Configuración
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
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Función para el chat (asegúrate de que esta función exista si la llamas en el router)
const askRiley = async (req, res) => {
  res.status(200).json({ success: true, message: "Chat activo" });
};

// EXPORTACIÓN ÚNICA Y CLARA
module.exports = {
  setupAssistant,
  askRiley,
};
