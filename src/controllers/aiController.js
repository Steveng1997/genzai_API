const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    // Recibe dinámicamente el identificador del usuario
    const userEmail = req.body.email || req.body.businessId;

    if (!userEmail) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Identificador de usuario no proporcionado",
        });
    }

    // 1. Buscar info del negocio en Payments dinámicamente
    const paymentsData = await dynamoDB.send(
      new ScanCommand({
        TableName: "Payments",
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": userEmail.toLowerCase().trim() },
      }),
    );

    if (!paymentsData.Items || paymentsData.Items.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "No se encontró configuración de negocio para este usuario",
        });
    }

    const business = paymentsData.Items[0];
    const category = business.sellingProduct; // Dinámico: "Autos", "Ropa", etc.
    const company = business.company; // Dinámico: "Genzai", etc.

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

    // 3. Crear Asistente con parámetros dinámicos
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company} (${category})`,
      instructions: `Eres Riley, la asistente experta de ${company}. Tu especialidad es ${category}. Usa los archivos cargados para responder dudas y cerrar ventas de manera profesional.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs usando el producto/categoría como llave
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: category,
          assistantId: assistant.id,
          businessName: company,
          ownerEmail: userEmail.toLowerCase().trim(),
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: `Asistente para ${category} configurado correctamente`,
    });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
