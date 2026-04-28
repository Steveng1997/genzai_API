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
    instructions: `Eres Riley. Tu única misión es detectar si un documento es una FICHA TÉCNICA (isTechnicalSheet: true) o una IMAGEN/PUBLICIDAD (isTechnicalSheet: false). 
        Busca: medidas (mm), torque, potencia, airbags, frenos.
        Responde SOLO JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
  });
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
      console.log(`DEBUG: file.mimetype original = "${file.mimetype}"`);
      let mimeTypeForOpenAI = file.mimetype;
      if (
        file.originalname.toLowerCase().endsWith(".pdf") &&
        file.mimetype === "application/octet-stream"
      ) {
        mimeTypeForOpenAI = "application/pdf";
        console.log(
          "🛠️ Corrigiendo mimetype de octet-stream a application/pdf",
        );
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
        console.log(`📌 Match por NOMBRE detectado en [${file.originalname}]`);
        isSheet = true;
      }

      console.log(`DEBUG: isSheet antes de análisis profundo = ${isSheet}`);

      if (!isSheet) {
        console.log(`⚠️ Entrando a bloque de ANÁLISIS PROFUNDO...`);
        console.log(`DEBUG setupAssistant: file.mimetype = "${file.mimetype}"`);
        try {
          const isPDF =
            mimeTypeForOpenAI === "application/pdf" ||
            nameToTest.endsWith(".pdf");
          const isImage =
            file.mimetype.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

          if (isPDF) {
            console.log(`🔍 Analizando como PDF: ${file.originalname}`);

            // 2. CORRECCIÓN DE MÉTODO (Usamos createAndPoll que es más estándar en v4.x)
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
              console.log(`🤖 Respuesta: ${rawResponse}`);
              const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
              if (jsonMatch)
                isSheet = JSON.parse(jsonMatch[0]).isTechnicalSheet === true;
            }
          } else if (isImage) {
            console.log(`🔍 Analizando como IMAGEN...`);
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

    if (!file) return res.status(400).json({ error: "No file" });

    // 1. CORRECCIÓN DE MIMETYPE (Octet-stream a PDF)
    let mimeTypeForOpenAI = file.mimetype;
    if (
      file.originalname.toLowerCase().endsWith(".pdf") &&
      file.mimetype === "application/octet-stream"
    ) {
      mimeTypeForOpenAI = "application/pdf";
      console.log(
        "🛠️ Corrigiendo mimetype de octet-stream a application/pdf en analyzeProductImage",
      );
    }

    let result = { isTechnicalSheet: false, name: "Desconocido", price: 0 };
    const nameToTest = file.originalname.toLowerCase();

    // Detección previa por nombre
    if (
      ["ficha", "tecnica", "spec", "manual"].some((k) => nameToTest.includes(k))
    ) {
      result.isTechnicalSheet = true;
    }

    const isPDF =
      mimeTypeForOpenAI === "application/pdf" || nameToTest.endsWith(".pdf");
    const isImage =
      file.mimetype.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

    // --- CASO IMAGEN (GPT-4o Vision) ---
    if (isImage) {
      console.log("📷 Analizando imagen con GPT-4o Vision...");
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Analiza esta imagen de producto. Extrae la información en este formato JSON estricto: {"isTechnicalSheet": boolean, "name": "string", "price": number}. Si no hay precio, pon 0.',
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
      const aiData = JSON.parse(resp.choices[0].message.content);
      result = { ...result, ...aiData };

      // --- CASO PDF (OpenAI Assistants + File Search) ---
    } else if (isPDF) {
      console.log("📄 Analizando PDF con File Search...");
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname, {
          type: mimeTypeForOpenAI,
        }),
        purpose: "assistants",
      });

      const vs = await openai.beta.vectorStores.create({
        name: `Validator-${uuidv4()}`,
        file_ids: [f.id],
      });

      const tempAssistant = await openai.beta.assistants.create({
        name: "Data Extractor",
        instructions:
          "Eres un extractor de datos. Busca el nombre del producto y su precio. Responde solo JSON.",
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
        tool_resources: { file_search: { vector_store_ids: [vs.id] } },
      });

      const thread = await openai.beta.threads.create({
        messages: [
          {
            role: "user",
            content:
              'Extrae del documento: {"isTechnicalSheet": boolean, "name": "string", "price": number}. Responde solo el objeto JSON.',
          },
        ],
      });

      const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
        assistant_id: tempAssistant.id,
      });

      if (run.status === "completed") {
        const m = await openai.beta.threads.messages.list(run.thread_id);
        const content = m.data[0].content[0].text.value;
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          result = { ...result, ...JSON.parse(match[0]) };
        }
      }

      // Limpieza de recursos temporales
      await openai.files.del(f.id);
      await openai.beta.vectorStores.del(vs.id);
      await openai.beta.assistants.del(tempAssistant.id);
    }

    // Actualización de contadores
    if (email) await updateCounter(tenantId, email, result.isTechnicalSheet);

    console.log("📊 RESULTADO FINAL:", result);
    res.status(200).json(result);
  } catch (e) {
    console.error("❌ Error en analyzeProductImage:", e.message);
    res.status(500).json({ error: e.message });
  }
};
