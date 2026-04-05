const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.businessId;

    if (!rawEmail) {
      return res
        .status(400)
        .json({ success: false, message: "No llegó el email al servidor" });
    }

    const emailToSearch = rawEmail.toLowerCase().trim();
    console.log("===> PASO 1: Iniciando búsqueda para:", emailToSearch);

    // 1. Traemos TODOS los registros de Payments para buscar manualmente
    // Esto es para depuración; si hay pocos registros, es infalible.
    const allPayments = await dynamoDB.send(
      new ScanCommand({
        TableName: "Payments",
      }),
    );

    console.log(
      `===> PASO 2: Total registros en tabla Payments: ${allPayments.Items.length}`,
    );

    // Buscamos el registro que coincida con el email
    const business = allPayments.Items.find((item) => {
      const dbEmail = (item.email || "").toLowerCase().trim();
      return dbEmail === emailToSearch;
    });

    if (!business) {
      // Si no lo encuentra, imprimimos qué emails SÍ hay en la tabla para comparar
      const existingEmails = allPayments.Items.map((i) => i.email).join(", ");
      console.log(
        "===> PASO 3: No se encontró el email. Emails en la tabla:",
        existingEmails,
      );

      return res.status(404).json({
        success: false,
        message: `Suscripción no encontrada para ${emailToSearch}. En la tabla hay: ${existingEmails}`,
      });
    }

    // Si llegamos aquí, lo encontramos
    const category = business.sellingProduct || "General";
    const company = business.company || "Negocio Genzai";
    console.log(
      `===> PASO 4: Match encontrado! Empresa: ${company}, Producto: ${category}`,
    );

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
      instructions: `Eres Riley, experta en ${category} para ${company}. Usa los archivos para responder.`,
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      model: "gpt-4o",
    });

    // 4. Guardar en AIConfigs
    // Importante: Usamos 'businessId' como Partition Key según tu imagen de AIConfigs
    await dynamoDB.send(
      new PutCommand({
        TableName: "AIConfigs",
        Item: {
          businessId: category,
          assistantId: assistant.id,
          businessName: company,
          ownerEmail: emailToSearch,
          status: "active",
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: `¡Riley lista! Sector: ${category}`,
    });
  } catch (error) {
    console.error("===> ERROR CRÍTICO:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
