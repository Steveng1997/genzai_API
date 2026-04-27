const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// Inicialización de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

/**
 * Crea un asistente en OpenAI si no existe
 */
const createOpenAIAssistant = async (company) => {
  console.log(
    `🤖 [OpenAI] Creando asistente para: ${company || "Empresa genérica"}`,
  );
  try {
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company || "Empresa"}`,
      instructions: `Eres Riley, soporte inteligente de ${company || "la empresa"}. Usa tus archivos y herramientas para ayudar al usuario de forma precisa.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    console.log(`✅ [OpenAI] Asistente creado ID: ${assistant.id}`);
    return assistant.id;
  } catch (error) {
    console.error("❌ [OpenAI] Error creando asistente:", error.message);
    throw error;
  }
};

/**
 * Obtiene la configuración de un tenant
 */
exports.getConfig = async (req, res) => {
  const { tenantId } = req.params;
  console.log(`🔍 [DynamoDB] Consultando config para tenantId: ${tenantId}`);
  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );
    res.status(200).json(Items?.[0] || {});
  } catch (e) {
    console.error("❌ [Internal] Error en getConfig:", e.message);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Chatea con Riley (Assistant API)
 */
exports.askRiley = async (req, res) => {
  const { message, tenantId, company } = req.body;
  if (!message || !tenantId)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    console.log(`💬 [Chat] Nueva consulta de tenant: ${tenantId}`);

    // 1. Obtener Configuración
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    let Item = Items?.[0];
    let assistantId = Item?.openaiAssistantId;
    let agentId = Item?.agentId || uuidv4();

    // 2. Validar o Crear Asistente
    if (!assistantId) {
      console.warn("⚠️ No se encontró AssistantID en DB. Creando uno nuevo...");
      assistantId = await createOpenAIAssistant(company || Item?.company);
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CONFIGS,
          Key: { tenantId: tenantId.toString(), agentId: agentId },
          UpdateExpression:
            "SET openaiAssistantId = :oa, company = :c, updatedAt = :u",
          ExpressionAttributeValues: {
            ":oa": assistantId,
            ":c": company || "Empresa Genérica",
            ":u": new Date().toISOString(),
          },
        }),
      );
    }

    // 3. Validar o Crear Thread
    let threadId = Item?.activeThreadId;
    if (!threadId) {
      console.log("🧵 Creando nuevo Thread de conversación...");
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CONFIGS,
          Key: { tenantId: tenantId.toString(), agentId: agentId },
          UpdateExpression: "SET activeThreadId = :t",
          ExpressionAttributeValues: { ":t": threadId },
        }),
      );
    }

    // 4. Enviar Mensaje y Ejecutar
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    console.log("⏳ [OpenAI] Ejecutando y esperando respuesta (Poll)...");
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistantId,
    });

    if (run.status === "completed") {
      const messagesList = await openai.beta.threads.messages.list(threadId);
      const lastAssistantMessage = messagesList.data.find(
        (m) => m.role === "assistant",
      );
      const reply =
        lastAssistantMessage?.content[0]?.text?.value || "Sin respuesta.";
      console.log("✅ [OpenAI] Respuesta recibida");
      res.status(200).json({ reply });
    } else {
      console.error(`❌ [OpenAI] Run terminó con estado: ${run.status}`);
      res.status(500).json({ error: `OpenAI Status: ${run.status}` });
    }
  } catch (e) {
    console.error("❌ [Internal] Error fatal en askRiley:", e.message);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Configura archivos y Vector Store del asistente
 */
exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  const { email, company, tenantId } = req.body;

  console.log(
    `🚀 [Setup] Iniciando carga de archivos para: ${company || "Desconocido"} (${tenantId})`,
  );

  if (!tenantId) return res.status(400).json({ message: "tenantId requerido" });

  try {
    // 1. Obtener estado actual
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    let Item = Items?.[0];
    let assistantId =
      Item?.openaiAssistantId || (await createOpenAIAssistant(company));
    let agentId = Item?.agentId || uuidv4();

    const newFileIds = [];
    const newFileNames = [];

    // 2. Subida de archivos a OpenAI
    for (const file of files) {
      console.log(
        `📤 [OpenAI] Intentando subir: ${file.originalname} (${file.size} bytes)`,
      );

      /**
       * CORRECCIÓN 413: Usamos OpenAI.toFile para envolver el buffer
       * correctamente como un multipart/form-data válido.
       */
      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });

      console.log(
        `✅ [OpenAI] Archivo subido exitosamente ID: ${fileContext.id}`,
      );
      newFileIds.push(fileContext.id);
      newFileNames.push(file.originalname);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    // 3. Gestión de Vector Store
    if (newFileIds.length > 0) {
      console.log(
        `📂 [OpenAI] Creando Vector Store para ${newFileIds.length} archivos...`,
      );
      const vectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: finalFileIds,
      });
      console.log(`✅ [OpenAI] Vector Store creado: ${vectorStore.id}`);

      console.log("🔄 [OpenAI] Vinculando Vector Store al Asistente...");
      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [vectorStore.id] },
        },
      });
    }

    // 4. Persistencia en DynamoDB
    console.log("💾 [DynamoDB] Guardando IDs de archivos y asistente...");
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId.toString(), agentId: agentId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, openaiFileIds = :f, fileNames = :fn, updatedAt = :u, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":oa": assistantId,
          ":f": finalFileIds,
          ":fn": finalFileNames,
          ":u": new Date().toISOString(),
          ":c": company || Item?.company || "Empresa",
          ":e": email?.toLowerCase() || Item?.ownerEmail,
        },
      }),
    );

    console.log("✨ [Setup] Proceso finalizado con éxito.");
    res.status(200).json({ success: true, assistantId });
  } catch (e) {
    console.error("❌ [Critical] Error en setupAssistant:", e);
    // Enviamos el stack solo en desarrollo/logs, aquí lo enviamos para debuggear
    res
      .status(500)
      .json({ error: e.message, detail: "Error en proceso de archivos" });
  }
};

/**
 * Analiza imagen de producto usando GPT-4o Vision
 */
exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    console.log(`📸 [Vision] Analizando imagen para tenant: ${tenantId}`);

    if (!file) return res.status(400).json({ error: "No file provided" });

    let content = [
      {
        type: "text",
        text: 'Analyze image. Return JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
      },
    ];

    if (file.mimetype.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
        },
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(response.choices[0].message.content);
    const field = data.isTechnicalSheet
      ? "totalTechnicalSheets"
      : "totalProductImages";

    console.log(`📊 [Vision] Resultado: ${data.name}. Tipo: ${field}`);

    // Actualizar estadísticas del usuario
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_USERS,
        Key: {
          tenantId: tenantId.toString(),
          email: email.toLowerCase().trim(),
        },
        UpdateExpression: `ADD ${field} :inc SET updatedAt = :u`,
        ExpressionAttributeValues: {
          ":inc": 1,
          ":u": new Date().toISOString(),
        },
      }),
    );

    res.status(200).json(data);
  } catch (e) {
    console.error("❌ [Vision] Error en analyzeProductImage:", e.message);
    res.status(500).json({ error: e.message });
  }
};
