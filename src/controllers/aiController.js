const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

/**
 * Actualiza el contador en DynamoDB.
 */
const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  // Asegurar que isSheet sea un booleano puro
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
    console.log(
      `✅ CONTADOR: ${field} incrementado para ${email} (isSheet: ${isSheet})`,
    );
  } catch (error) {
    console.error("❌ Error DynamoDB Counter:", error.message);
  }
};

/**
 * Crea el asistente Riley.
 * Se refuerza el System Prompt para que no se deje engañar por nombres de archivos genéricos.
 */
const createOpenAIAssistant = async (company) => {
  return await openai.beta.assistants.create({
    name: `Riley - ${company || "Empresa"}`,
    instructions: `Eres un experto clasificador de documentos técnicos automotrices e industriales.
    
    TU REGLA ABSOLUTA: No te bases en el nombre del archivo. Debes inspeccionar el contenido.
    
    SI EL DOCUMENTO CONTIENE:
    - Medidas con "mm" (ej. 1,635mm, 4,740mm).
    - Sistemas de seguridad (ABS, ESP, Airbags, ISOFIX).
    - Especificaciones de motor o transmisión (Paddle Shift, 6 velocidades).
    - Tablas de equipamiento o colores.
    
    ENTONCES es una Ficha Técnica (isTechnicalSheet: true).
    
    SI EL DOCUMENTO ES:
    - Una foto de un producto sin datos técnicos, tablas o medidas.
    - Publicidad estética pura.
    
    ENTONCES es una Imagen de Producto (isTechnicalSheet: false).
    
    Responde estrictamente en JSON: {"isTechnicalSheet": boolean}`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }], // Aseguramos que file_search esté activo
  });
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

      if (
        fileNameLower.includes("ficha") ||
        fileNameLower.includes("tecnica") ||
        fileNameLower.includes("spec") ||
        fileNameLower.includes("manual")
      ) {
        isSheet = true;
      }

      // 2. Si no se detectó por nombre, OBLIGAMOS a la IA a analizar el contenido ignorando el nombre.
      if (!isSheet) {
        try {
          if (file.mimetype === "application/pdf") {
            const run = await openai.beta.threads.createAndRunAndPoll({
              assistant_id: assistantId,
              thread: {
                messages: [
                  {
                    role: "user",
                    content: `INSTRUCCIÓN DE SEGURIDAD: Debes ignorar el nombre del archivo "${file.originalname}". 
                    Realiza una búsqueda profunda en el documento (file_search). 
                    Si encuentras tablas de medidas, especificaciones de motor, o sistemas de seguridad (ABS, Airbags), marca isTechnicalSheet como true. 
                    Responde solo el JSON: {"isTechnicalSheet": boolean}`,
                    attachments: [
                      {
                        file_id: fileContext.id,
                        tools: [{ type: "file_search" }],
                      },
                    ],
                  },
                ],
              },
            });

            if (run.status === "completed") {
              const msgs = await openai.beta.threads.messages.list(
                run.thread_id,
              );
              const rawText = msgs.data[0].content[0].text.value;
              const jsonMatch = rawText.match(/\{[\s\S]*\}/); // Regex mejorada
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                isSheet = !!parsed.isTechnicalSheet; // Forzamos booleano
              }
            }
          } else if (file.mimetype.startsWith("image/")) {
            // ... (Tu código de visión está bien, pero asegúrate de parsear con try/catch)
            const vision = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: '¿Es una ficha técnica con medidas y datos de ingeniería? Responde JSON: {"isTechnicalSheet": boolean}',
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
        } catch (parseError) {
          console.error("Error analizando archivo con IA:", parseError);
          isSheet = false; // Fallback seguro
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
    const fileNameLower = file.originalname?.toLowerCase() || "";

    // Detección manual inmediata
    if (
      fileNameLower.includes("ficha") ||
      fileNameLower.includes("tecnica") ||
      fileNameLower.includes("manual")
    ) {
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
                text: 'Ignora el nombre del archivo. Si ves tablas de medidas o ingeniería, isTechnicalSheet es true. JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
                'Analiza este PDF. Busca tablas de especificaciones y medidas (mm). No te guíes por el nombre. ¿Es Ficha Técnica? JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
