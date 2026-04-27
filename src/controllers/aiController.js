const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

/**
 * Actualiza el contador en DynamoDB.
 * Convierte el resultado a booleano real para evitar errores de tipo.
 */
const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  const isSheet = String(isTechnicalSheet).toLowerCase() === "true";
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
 * Crea el asistente Riley con instrucciones maestras de clasificación técnica.
 */
const createOpenAIAssistant = async (company) => {
  try {
    return await openai.beta.assistants.create({
      name: `Riley - ${company || "Empresa"}`,
      instructions: `Eres un experto en ingeniería industrial. Tu única misión es clasificar archivos.
      REGLAS PARA FICHA TÉCNICA (isTechnicalSheet: true):
      - El documento contiene tablas de especificaciones, medidas numéricas (mm, cm, kg, hp).
      - Menciona sistemas de seguridad (ABS, Airbags, ISOFIX) o detalles de motor.
      REGLAS PARA IMAGEN DE PRODUCTO (isTechnicalSheet: false):
      - Es una foto limpia, publicitaria o catálogo visual sin tablas de datos técnicos.
      RESPONDE ÚNICAMENTE EN JSON: {"isTechnicalSheet": boolean}`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
  } catch (error) {
    throw error;
  }
};

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
      res
        .status(200)
        .json({
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
      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });
      newFileIds.push(fileContext.id);
      newFileNames.push(file.originalname);

      let isSheet = false;
      const fileNameLower = file.originalname.toLowerCase();

      // --- LOGICA DE IDENTIFICACIÓN ---
      // 1. Prioridad por nombre de archivo
      if (
        fileNameLower.includes("ficha") ||
        fileNameLower.includes("tecnica") ||
        fileNameLower.includes("spec") ||
        fileNameLower.includes("manual")
      ) {
        isSheet = true;
      }
      // 2. Si el nombre es ambiguo, analizar contenido
      else if (file.mimetype === "application/pdf") {
        const run = await openai.beta.threads.createAndRunAndPoll({
          assistant_id: assistantId,
          thread: {
            messages: [
              {
                role: "user",
                content:
                  'Analiza este documento. Busca tablas de medidas, seguridad (ABS, Airbags, ISOFIX) o especificaciones de ingeniería. ¿Es una Ficha Técnica? Responde JSON: {"isTechnicalSheet": boolean}',
                attachments: [
                  { file_id: fileContext.id, tools: [{ type: "file_search" }] },
                ],
              },
            ],
          },
        });

        if (run.status === "completed") {
          const msgs = await openai.beta.threads.messages.list(run.thread_id);
          const raw = msgs.data[0].content[0].text.value;
          const match = raw.match(/\{.*\}/s);
          if (match) isSheet = JSON.parse(match[0]).isTechnicalSheet;
        }
      } else if (file.mimetype.startsWith("image/")) {
        const vision = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: '¿Es una ficha técnica con tablas de medidas o solo una foto publicitaria? Responde JSON: {"isTechnicalSheet": boolean}',
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
        isSheet = JSON.parse(
          vision.choices[0].message.content,
        ).isTechnicalSheet;
      }

      if (email) await updateCounter(tenantId, email, isSheet);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    if (newFileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: newFileIds,
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
    console.error("Error en Setup:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });

    let result = { isTechnicalSheet: false, name: "Desconocido", price: 0 };
    const fileNameLower = file.originalname?.toLowerCase() || "";

    // Detección rápida por nombre
    if (fileNameLower.includes("ficha") || fileNameLower.includes("tecnica")) {
      result.isTechnicalSheet = true;
    }

    if (file.mimetype.startsWith("image/")) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Si ves tablas o datos de ingeniería (mm, kg, ABS), isTechnicalSheet es true. JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
      const parsed = JSON.parse(resp.choices[0].message.content);
      result.isTechnicalSheet =
        result.isTechnicalSheet || parsed.isTechnicalSheet;
      result.name = parsed.name;
      result.price = parsed.price;
    } else if (file.mimetype === "application/pdf") {
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });
      const tempId = await createOpenAIAssistant("Validator").then((a) => a.id);
      const r = await openai.beta.threads.createAndRunAndPoll({
        assistant_id: tempId,
        thread: {
          messages: [
            {
              role: "user",
              content:
                'Busca tablas de especificaciones. ¿Es Ficha Técnica? JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
              attachments: [
                { file_id: f.id, tools: [{ type: "file_search" }] },
              ],
            },
          ],
        },
      });
      if (r.status === "completed") {
        const m = await openai.beta.threads.messages.list(r.thread_id);
        const match = m.data[0].content[0].text.value.match(/\{.*\}/s);
        if (match) {
          const parsed = JSON.parse(match[0]);
          result.isTechnicalSheet =
            result.isTechnicalSheet || parsed.isTechnicalSheet;
          result.name = parsed.name;
          result.price = parsed.price;
        }
      }
      await openai.files.del(f.id);
      await openai.beta.assistants.del(tempId);
    }

    if (email) await updateCounter(tenantId, email, result.isTechnicalSheet);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
