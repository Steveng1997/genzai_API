const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    // Identificador dinámico enviado desde el Frontend
    const userEmail = req.body.email || req.body.businessId;

    if (!userEmail) {
      return res
        .status(400)
        .json({ success: false, message: "Email del usuario es requerido" });
    }

    // 1. Buscar información del negocio en Payments (Dinámico)
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
          message: "No se encontró suscripción para este usuario",
        });
    }

    const business = paymentsData.Items[0];
    const category = business.sellingProduct; // ej: "Autos"
    const company = business.company; // ej: "Genzai"

    // 2. Subir archivos a OpenAI
    let fileIds = [];
    const files = req.files || [];
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);
      // Limpiar archivo temporal del servidor
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente con parámetros del negocio
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company} (${category})`,
      instructions: `Eres Riley, la asistente experta de ${company}. Tu especialidad es el sector de ${category}. Usa los archivos cargados para responder dudas y cerrar ventas.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs usando el producto/categoría como llave (Partition Key)
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: category,
          assistantId: assistant.id,
          businessName: company,
          ownerEmail: userEmail.toLowerCase().trim(),
          status: "active",
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: `Riley configurada con éxito para el nicho de ${category}`,
    });
  } catch (error) {
    console.error("Error en setupAssistant:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.askRiley = (req, res) => res.status(200).json({ success: true });
