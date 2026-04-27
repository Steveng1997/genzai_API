const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  const field = isTechnicalSheet
    ? "totalTechnicalSheets"
    : "totalProductImages";
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
    console.error("Error DynamoDB:", error.message);
  }
};

const createOpenAIAssistant = async (company) => {
  try {
    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company || "Empresa"}`,
      instructions: `Eres Riley, un experto en ingeniería y análisis de documentos industriales. 
      Tu objetivo es clasificar documentos con precisión quirúrgica:
      
      - FICHA TÉCNICA (isTechnicalSheet: true): Documentos que contienen especificaciones de ingeniería, tablas de torque, dimensiones (mm, cm, pulgadas), diagramas de componentes, materiales químicos, normativas ISO/ANSI, o características de rendimiento (HP, RPM, Voltaje). 
      - IMAGEN DE PRODUCTO (isTechnicalSheet: false): Fotos de catálogo, publicidad, fotos del objeto real sin datos técnicos, o simples banners promocionales.

      Responde SIEMPRE en formato JSON.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });
    return assistant.id;
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

      let isSheet = false;

      if (file.mimetype.startsWith("image/")) {
        const vision = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Analiza si esta imagen es una Ficha Técnica Industrial (con tablas, medidas, diagramas o textos técnicos de ingeniería) o solo una Foto de Producto/Publicidad. Responde JSON estrictamente: {"isTechnicalSheet": boolean}',
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
      } else if (file.mimetype === "application/pdf") {
        const run = await openai.beta.threads.createAndRunAndPoll({
          assistant_id: assistantId,
          thread: {
            messages: [
              {
                role: "user",
                content:
                  'Escanea este PDF. Si contiene tablas de datos, dimensiones técnicas, especificaciones de motor/materiales o normativas, clasifícalo como Ficha Técnica (true). Responde JSON: {"isTechnicalSheet": boolean}',
                attachments: [
                  { file_id: fileContext.id, tools: [{ type: "file_search" }] },
                ],
              },
            ],
          },
        });
        if (run.status === "completed") {
          const msgs = await openai.beta.threads.messages.list(run.thread_id);
          const rawResponse = msgs.data[0].content[0].text.value;
          const jsonMatch = rawResponse.match(/\{.*\}/s);
          if (jsonMatch) isSheet = JSON.parse(jsonMatch[0]).isTechnicalSheet;
        }
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
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });
    let result = { isTechnicalSheet: false, name: "Desconocido", price: 0 };

    if (file.mimetype.startsWith("image/")) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Analiza la imagen. Si ves tablas técnicas, dimensiones o listas de especificaciones industriales, isTechnicalSheet es true. JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
      result = JSON.parse(resp.choices[0].message.content);
    } else if (file.mimetype === "application/pdf") {
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });
      const tempAssistantId = await createOpenAIAssistant("Validator");
      const r = await openai.beta.threads.createAndRunAndPoll({
        assistant_id: tempAssistantId,
        thread: {
          messages: [
            {
              role: "user",
              content:
                'Determina si este PDF es una Ficha Técnica Industrial (true) o solo un catálogo de fotos (false). Busca tablas, medidas y datos técnicos. JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
        if (match) result = JSON.parse(match[0]);
      }
      await openai.files.del(f.id);
      await openai.beta.assistants.del(tempAssistantId);
    }

    if (email) await updateCounter(tenantId, email, result.isTechnicalSheet);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
