const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// Inicialización de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

/**
 * Función auxiliar para actualizar estadísticas en DynamoDB
 */
const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  const field = isTechnicalSheet
    ? "totalTechnicalSheets"
    : "totalProductImages";
  console.log(`📊 Incrementando contador: ${field} para ${email}`);
  try {
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
  } catch (error) {
    console.error("⚠️ Error actualizando DynamoDB:", error.message);
  }
};

/**
 * Crea un asistente en OpenAI si no existe
 */
const createOpenAIAssistant = async (company) => {
  console.log(`🤖 [OpenAI] Creando asistente para: ${company || "Empresa"}`);
  try {
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company || "Empresa"}`,
      instructions: `Eres Riley, experto en análisis de documentos y fichas técnicas. Tu objetivo es identificar si un archivo es una ficha técnica industrial o una simple imagen de producto.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    return assistant.id;
  } catch (error) {
    console.error("❌ [OpenAI] Error creando asistente:", error.message);
    throw error;
  }
};

/**
 * 1. OBTENER CONFIGURACIÓN
 */
exports.getConfig = async (req, res) => {
  const { tenantId } = req.params;
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
    res.status(500).json({ error: e.message });
  }
};

/**
 * 2. CHAT CON RILEY (Assistant API)
 */
exports.askRiley = async (req, res) => {
  const { message, tenantId, company } = req.body;
  if (!message || !tenantId)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    let Item = Items?.[0];
    let assistantId =
      Item?.openaiAssistantId ||
      (await createOpenAIAssistant(company || Item?.company));
    let agentId = Item?.agentId || uuidv4();

    let threadId = Item?.activeThreadId;
    if (!threadId) {
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

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistantId,
    });

    if (run.status === "completed") {
      const messagesList = await openai.beta.threads.messages.list(threadId);
      const lastAssistantMessage = messagesList.data.find(
        (m) => m.role === "assistant",
      );
      res.status(200).json({
        reply:
          lastAssistantMessage?.content[0]?.text?.value || "Sin respuesta.",
      });
    } else {
      res.status(500).json({ error: `OpenAI Status: ${run.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * 3. SETUP ASSISTANT (Carga masiva de archivos base)
 */
exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  const { email, company, tenantId } = req.body;
  if (!tenantId) return res.status(400).json({ message: "tenantId requerido" });

  try {
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

    for (const file of files) {
      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });
      newFileIds.push(fileContext.id);
      newFileNames.push(file.originalname);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    if (newFileIds.length > 0) {
      // VALIDACIÓN DE SEGURIDAD PARA EL SDK
      if (!openai.beta.vectorStores) {
        throw new Error(
          "El SDK de OpenAI no soporta 'vectorStores'. Ejecuta: npm install openai@latest",
        );
      }

      const vectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: newFileIds, // Subimos solo los nuevos para optimizar
      });

      await openai.beta.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
    }

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
          ":e": email?.toLowerCase() || Item?.ownerEmail || "N/A",
        },
      }),
    );

    res.status(200).json({ success: true, assistantId });
  } catch (e) {
    console.error("❌ Error en setupAssistant:", e.message);
    res.status(500).json({ error: e.message });
  }
};

/**
 * 4. ANALIZADOR MULTIMODAL (IMÁGENES + PDF)
 */
exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    let result = { isTechnicalSheet: false, name: "Desconocido", price: 0 };

    if (file.mimetype.startsWith("image/")) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Analiza la imagen. Retorna JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });
      result = JSON.parse(response.choices[0].message.content);
    } else if (file.mimetype === "application/pdf") {
      const openAIFile = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });

      const run = await openai.beta.threads.createAndRunAndPoll({
        assistant_id: await createOpenAIAssistant("Analizador Pro"),
        thread: {
          messages: [
            {
              role: "user",
              content:
                "Analiza el PDF adjunto. Responde solo JSON: {isTechnicalSheet: boolean, name: string, price: number}",
              attachments: [
                { file_id: openAIFile.id, tools: [{ type: "file_search" }] },
              ],
            },
          ],
        },
      });

      if (run.status === "completed") {
        const messages = await openai.beta.threads.messages.list(run.thread_id);
        const text = messages.data[0].content[0].text.value;
        const jsonMatch = text.match(/\{.*\}/s);
        result = JSON.parse(jsonMatch[0]);
      }
      await openai.files.del(openAIFile.id);
    } else {
      return res.status(400).json({ error: "Solo JPG, PNG o PDF" });
    }

    await updateCounter(tenantId, email, result.isTechnicalSheet);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
