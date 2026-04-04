const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const { email } = req.body; // Recibimos el email del programador/dueño
    const files = req.files || [];

    // 1. Buscamos en Payments para obtener el producto y la empresa
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
        .json({
          success: false,
          message: "No se encontró suscripción para este email",
        });
    }

    const subscription = paymentsData.Items[0];
    const productKey = subscription.sellingProduct; // Ejemplo: "Autos"
    const companyName = subscription.company; // Ejemplo: "Genzai"

    // Creamos un nombre descriptivo para el asistente
    const displayName = `${companyName} - ${productKey}`;

    // 2. Subir archivos a OpenAI
    let fileIds = [];
    for (const file of files) {
      const response = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(response.id);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    // 3. Crear Asistente con contexto de NICHO
    const assistant = await openai.beta.assistants.create({
      name: `Riley (${displayName})`,
      instructions: `Eres Riley, especialista de ventas en el sector de ${productKey} para la empresa ${companyName}. 
      Tu objetivo es ser un experto en ${productKey}. Usa los archivos para conocer el inventario y precios.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs usando el PRODUCTO como ID
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: productKey, // AHORA ES "Autos", NO "steven_dev"
          assistantId: assistant.id,
          businessName: displayName,
          company: companyName,
          category: productKey,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      }),
    );

    res
      .status(200)
      .json({ success: true, message: `Riley entrenada para ${productKey}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
