const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

/**
 * Actualiza los contadores de uso en DynamoDB
 */
const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  const isSheet =
    isTechnicalSheet === true ||
    String(isTechnicalSheet).toLowerCase() === "true";
  const field = isSheet ? "totalTechnicalSheets" : "totalProductImages";

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
    console.log(`✅ CONTADOR: ${field} incrementado para ${email}`);
  } catch (error) {
    console.error("❌ Error DynamoDB Counter:", error.message);
  }
};

/**
 * Crea un asistente clasificador por defecto
 */
const createOpenAIAssistant = async (company) => {
  return await openai.beta.assistants.create({
    name: `Riley - Clasificador - ${company || "Empresa"}`,
    instructions: `Eres Riley. Tu misión es analizar documentos de productos. 
    Detecta si es una FICHA TÉCNICA (isTechnicalSheet: true) con especificaciones, 
    o una IMAGEN comercial (isTechnicalSheet: false). 
    Extrae: name, price, brand, model, reference, stock, description.`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
  });
};

// --- NUEVO MÉTODO: TRAER HISTORIAL DE OPENAI ---

exports.getChatHistory = async (req, res) => {
  const { tenantId } = req.params;

  try {
    // 1. Buscamos el threadId activo en DynamoDB para ese tenant
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    const threadId = Items?.[0]?.activeThreadId;

    if (!threadId) {
      console.log("ℹ️ No hay historial previo para este tenant.");
      return res.status(200).json([]);
    }

    // 2. Recuperamos los mensajes desde OpenAI
    const messages = await openai.beta.threads.messages.list(threadId);

    // 3. Formateamos para que Flutter lo reciba limpio
    const history = messages.data
      .map((m) => ({
        role: m.role,
        content: m.content[0]?.text?.value || "",
      }))
      .reverse(); // reverse para que el orden sea cronológico

    res.status(200).json(history);
  } catch (e) {
    console.error("❌ Error getChatHistory:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// --- MÉTODOS DE CONFIGURACIÓN Y CHAT ---

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
      (await createOpenAIAssistant(company || Item?.company).then((a) => a.id));
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
      res.status(500).json({ error: `Status: ${run.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// --- MÉTODOS DE PROCESAMIENTO DE ARCHIVOS ---

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
      Item?.openaiAssistantId ||
      (await createOpenAIAssistant(company).then((a) => a.id));
    let agentId = Item?.agentId || uuidv4();
    const newFileIds = [];
    const newFileNames = [];

    for (const file of files) {
      console.log(`\n--- INICIO PROCESAMIENTO: ${file.originalname} ---`);
      let mimeTypeForOpenAI = file.mimetype;
      if (
        file.originalname.toLowerCase().endsWith(".pdf") &&
        file.mimetype === "application/octet-stream"
      ) {
        mimeTypeForOpenAI = "application/pdf";
      }

      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname, {
          type: mimeTypeForOpenAI,
        }),
        purpose: "assistants",
      });

      const tempVectorStore = await openai.beta.vectorStores.create({
        name: `Temp-${fileContext.id}`,
        file_ids: [fileContext.id],
      });

      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [tempVectorStore.id] },
        },
      });

      newFileIds.push(fileContext.id);
      newFileNames.push(file.originalname);

      let isSheet = false;
      const nameToTest = file.originalname.toLowerCase();
      const sheetKeywords = ["ficha", "tecnica", "spec", "manual", "datos"];

      if (sheetKeywords.some((k) => nameToTest.includes(k))) {
        isSheet = true;
      }

      if (!isSheet) {
        try {
          const isPDF =
            mimeTypeForOpenAI === "application/pdf" ||
            nameToTest.endsWith(".pdf");
          const isImage =
            file.mimetype.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

          if (isPDF) {
            const thread = await openai.beta.threads.create({
              messages: [
                {
                  role: "user",
                  content: `¿Es "${file.originalname}" una ficha técnica? Responde JSON: {"isTechnicalSheet": boolean}`,
                  attachments: [
                    {
                      file_id: fileContext.id,
                      tools: [{ type: "file_search" }],
                    },
                  ],
                },
              ],
            });

            const run = await openai.beta.threads.runs.createAndPoll(
              thread.id,
              {
                assistant_id: assistantId,
                instructions: "Responde solo JSON.",
              },
            );

            if (run.status === "completed") {
              const msgs = await openai.beta.threads.messages.list(
                run.thread_id,
              );
              const rawResponse = msgs.data[0].content[0].text.value;
              const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
              if (jsonMatch)
                isSheet = JSON.parse(jsonMatch[0]).isTechnicalSheet === true;
            }
          } else if (isImage) {
            const vision = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: '¿Es ficha técnica? JSON: {"isTechnicalSheet": boolean}',
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
            isSheet =
              JSON.parse(vision.choices[0].message.content).isTechnicalSheet ===
              true;
          }
        } catch (err) {
          console.error(`❌ Error analizando contenido:`, err.message);
        }
      }

      await openai.beta.vectorStores.del(tempVectorStore.id);
      if (email) await updateCounter(tenantId, email, isSheet);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    if (newFileIds.length > 0) {
      const mainVectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: finalFileIds,
      });
      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [mainVectorStore.id] },
        },
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
    console.error("❌ Error setupAssistant:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;

    if (!file)
      return res.status(400).json({ error: "No se recibió ningún archivo" });

    let mimeTypeForOpenAI = file.mimetype;
    if (
      file.originalname.toLowerCase().endsWith(".pdf") &&
      file.mimetype === "application/octet-stream"
    ) {
      mimeTypeForOpenAI = "application/pdf";
    }

    const nameToTest = file.originalname.toLowerCase();
    const isPDF =
      mimeTypeForOpenAI === "application/pdf" || nameToTest.endsWith(".pdf");
    const isImage =
      file.mimetype.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

    const extractionPrompt = `
      Analiza este archivo y extrae un JSON con este formato exacto:
      {
        "isTechnicalSheet": boolean (true si es ficha técnica con medidas/specs, false si es solo foto),
        "name": "string",
        "price": number,
        "brand": "string",
        "model": "string",
        "reference": "string",
        "stock": number,
        "description": "string",
        "category": "string",
        "productType": "string",
        "colors": "string",
        "observations": "string"
      }
      Si no encuentras un valor, usa "N/A" para texto o 0 para números.
    `;

    let result = { isTechnicalSheet: false };

    if (isImage) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompt },
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
      result = JSON.parse(resp.choices[0].message.content);
    } else if (isPDF) {
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname, {
          type: mimeTypeForOpenAI,
        }),
        purpose: "assistants",
      });

      const vs = await openai.beta.vectorStores.create({
        name: `Temp-Analyze-${uuidv4()}`,
        file_ids: [f.id],
      });

      const tempAssistant = await openai.beta.assistants.create({
        name: "Extractor Temporal",
        instructions: "Extrae datos de productos en formato JSON.",
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
        tool_resources: { file_search: { vector_store_ids: [vs.id] } },
      });

      const thread = await openai.beta.threads.create({
        messages: [{ role: "user", content: extractionPrompt }],
      });

      const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
        assistant_id: tempAssistant.id,
      });

      if (run.status === "completed") {
        const msgs = await openai.beta.threads.messages.list(run.thread_id);
        const match = msgs.data[0].content[0].text.value.match(/\{[\s\S]*\}/);
        if (match) result = JSON.parse(match[0]);
      }

      await openai.files.del(f.id);
      await openai.beta.vectorStores.del(vs.id);
      await openai.beta.assistants.del(tempAssistant.id);
    }

    if (email) {
      await updateCounter(tenantId, email, result.isTechnicalSheet);
    }

    res.status(200).json(result);
  } catch (e) {
    console.error("❌ Error en analyzeProductImage:", e.message);
    res.status(500).json({ error: "Error procesando el análisis de la IA" });
  }
};
