const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

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
    console.log(
      `✅ CONTADOR: ${field} incrementado para ${email} (Ficha: ${isSheet})`,
    );
  } catch (error) {
    console.error("❌ Error DynamoDB Counter:", error.message);
  }
};

const createOpenAIAssistant = async (company) => {
  return await openai.beta.assistants.create({
    name: `Riley - Clasificador - ${company || "Empresa"}`,
    instructions: `Eres Riley. Tu única misión es detectar si un documento es una FICHA TÉCNICA (isTechnicalSheet: true) o una IMAGEN/PUBLICIDAD (isTechnicalSheet: false). 
        Busca: medidas (mm), torque, potencia, airbags, frenos. 
        Responde SOLO JSON: {"isTechnicalSheet": boolean}`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
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
      console.log(`\n--- INICIO PROCESAMIENTO: ${file.originalname} ---`);

      // LOG SOLICITADO: Ver el valor real del mimetype enviado
      console.log(
        `DEBUG: file.mimetype para [${file.originalname}] es: "${file.mimetype}"`,
      );

      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });

      const tempVectorStore = await openai.beta.vectorStores.create({
        name: `Temp-Verify-${fileContext.id}`,
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
        console.log(
          `⚠️ No se detectó por nombre. Entrando a bloque de ANÁLISIS PROFUNDO...`,
        );

        console.log(`DEBUG setupAssistant: file.mimetype = "${file.mimetype}"`);
        try {
          // Robustez: Validar por Mimetype O por extensión de nombre
          const isPDF =
            file.mimetype === "application/pdf" || nameToTest.endsWith(".pdf");
          const isImage =
            file.mimetype.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

          if (isPDF) {
            console.log(
              `🔍 Llamando a OpenAI (file_search) para PDF detectado.`,
            );
            const run = await openai.beta.threads.createAndRunAndPoll({
              assistant_id: assistantId,
              instructions:
                "Eres un clasificador de documentos técnicos. Lee el archivo y determina si es una ficha técnica. Responde solo JSON.",
              thread: {
                messages: [
                  {
                    role: "user",
                    content: `¿Es "${file.originalname}" una ficha técnica? Analiza el contenido. Responde JSON: {"isTechnicalSheet": boolean}`,
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
              const rawResponse = msgs.data[0].content[0].text.value;
              console.log(
                `🤖 Riley dice sobre el contenido PDF: ${rawResponse}`,
              );

              const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                isSheet = result.isTechnicalSheet === true;
              }
            }
          } else if (isImage) {
            console.log(`🔍 Usando GPT-4o Vision para imagen detectada.`);
            const vision = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: '¿Es esto una ficha técnica? JSON: {"isTechnicalSheet": boolean}',
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
          } else {
            console.log(
              `🚫 El archivo no entró a PDF ni a IMAGEN. Revisa el Mimetype.`,
            );
          }
        } catch (err) {
          console.error(`❌ Error analizando contenido:`, err.message);
        }
      }

      await openai.beta.vectorStores.del(tempVectorStore.id);

      if (email) {
        console.log(
          `📊 RESULTADO FINAL PARA [${file.originalname}]: ${isSheet ? "FICHA TÉCNICA" : "IMAGEN/OTRO"}`,
        );
        await updateCounter(tenantId, email, isSheet);
      }
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

    // LOG ADICIONAL PARA LA FUNCIÓN INDIVIDUAL
    console.log(
      `DEBUG analyzeProductImage: file.mimetype = "${file.mimetype}"`,
    );

    let result = { isTechnicalSheet: false, name: "Desconocido", price: 0 };
    const nameToTest = file.originalname.toLowerCase();

    if (
      ["ficha", "tecnica", "spec", "manual"].some((k) => nameToTest.includes(k))
    ) {
      result.isTechnicalSheet = true;
    }

    const isPDF =
      file.mimetype === "application/pdf" || nameToTest.endsWith(".pdf");
    const isImage =
      file.mimetype.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

    if (isImage) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Extrae JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
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
      result = { ...result, ...JSON.parse(resp.choices[0].message.content) };
    } else if (isPDF) {
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname),
        purpose: "assistants",
      });

      const vs = await openai.beta.vectorStores.create({
        name: `Validate-Single-${f.id}`,
        file_ids: [f.id],
      });

      const tempId = await createOpenAIAssistant("Validator").then((a) => a.id);
      await openai.beta.assistants.update(tempId, {
        tool_resources: { file_search: { vector_store_ids: [vs.id] } },
      });

      const r = await openai.beta.threads.createAndRunAndPoll({
        assistant_id: tempId,
        thread: {
          messages: [
            {
              role: "user",
              content:
                'Extrae JSON: {"isTechnicalSheet": boolean, "name": "string", "price": number}',
            },
          ],
        },
      });

      if (r.status === "completed") {
        const m = await openai.beta.threads.messages.list(r.thread_id);
        const match = m.data[0].content[0].text.value.match(/\{.*\}/s);
        if (match) result = { ...result, ...JSON.parse(match[0]) };
      }

      await openai.files.del(f.id);
      await openai.beta.vectorStores.del(vs.id);
      await openai.beta.assistants.del(tempId);
    }

    if (email) await updateCounter(tenantId, email, result.isTechnicalSheet);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
