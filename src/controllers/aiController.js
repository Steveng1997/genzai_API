const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

const createOpenAIAssistant = async (company) => {
  const assistant = await openai.beta.assistants.create({
    name: `Riley - ${company || "Empresa"}`,
    instructions: `Eres Riley, soporte inteligente de ${company || "la empresa"}. Usa tus archivos y herramientas para ayudar al usuario de forma precisa.`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
  });
  return assistant.id;
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
    let assistantId = Item?.openaiAssistantId;
    let agentId = Item?.agentId || uuidv4();

    if (!assistantId) {
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
      const upload = await openai.files.create({
        file: {
          url: "file.originalname",
          content: file.buffer,
          name: file.originalname,
        },
        purpose: "assistants",
      });
      newFileIds.push(upload.id);
      newFileNames.push(file.originalname);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    if (newFileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: newFileIds, // Solo los nuevos para este VS
      });

      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [vectorStore.id] },
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
          ":e": email?.toLowerCase() || Item?.ownerEmail,
        },
      }),
    );

    res.status(200).json({ success: true, assistantId });
  } catch (e) {
    console.error("❌ Error en setupAssistant:", e);
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });

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
    res.status(500).json({ error: e.message });
  }
};
