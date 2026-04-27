const OpenAI = require("openai");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  UpdateCommand,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

exports.getConfig = async (req, res) => {
  const { tenantId } = req.params;
  console.log("🔍 getConfig - tenantId:", tenantId);
  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );
    console.log(
      "✅ getConfig - Resultado:",
      Items?.[0] ? "Encontrado" : "Vacío",
    );
    res.status(200).json(Items?.[0] || {});
  } catch (e) {
    console.error("❌ getConfig Error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.askRiley = async (req, res) => {
  const { message, tenantId } = req.body;
  console.log("📨 askRiley - Request:", { tenantId, message });

  if (!message || !tenantId) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    const Item = Items?.[0];
    const assistantId = Item?.openaiAssistantId;
    console.log("🤖 askRiley - AssistantId:", assistantId);

    if (!assistantId) {
      console.error(
        "⚠️ Error: No se encontró openaiAssistantId para tenantId:",
        tenantId,
      );
      return res.status(404).json({
        error: "Asistente no configurado",
        detalle: "Debes ejecutar el setup primero para este tenantId.",
      });
    }

    let threadId = Item?.activeThreadId;
    if (!threadId) {
      console.log("🆕 Creando nuevo thread de conversación...");
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CONFIGS,
          Key: {
            tenantId: Item.tenantId,
            agentId: Item.agentId,
          },
          UpdateExpression: "SET activeThreadId = :t",
          ExpressionAttributeValues: { ":t": threadId },
        }),
      );
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    console.log("⏳ OpenAI - Procesando respuesta...");
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistantId,
    });

    if (run.status === "completed") {
      const messagesList = await openai.beta.threads.messages.list(threadId);
      const lastAssistantMessage = messagesList.data.find(
        (m) => m.role === "assistant",
      );
      const reply =
        lastAssistantMessage?.content[0]?.text?.value ||
        "No pude generar una respuesta.";
      console.log("📤 Respuesta de Riley enviada");
      res.status(200).json({ reply });
    } else {
      console.error("❌ OpenAI Run Status:", run.status);
      res.status(500).json({ error: `Estado de OpenAI: ${run.status}` });
    }
  } catch (e) {
    console.error("❌ Error crítico en askRiley:", e);
    res
      .status(500)
      .json({ error: "Error interno del servidor", detalle: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file)
      return res.status(400).json({ error: "Archivo no proporcionado" });

    let messageContent = [];
    if (file.mimetype.startsWith("image/")) {
      const base64Image = file.buffer.toString("base64");
      messageContent = [
        {
          type: "text",
          text: 'Analyze this image. Output JSON only: {"isTechnicalSheet": boolean, "name": "string", "price": number, "description": "string", "category": "string"}',
        },
        {
          type: "image_url",
          image_url: { url: `data:${file.mimetype};base64,${base64Image}` },
        },
      ];
    } else {
      const textContent = file.buffer.toString("utf-8");
      messageContent = [
        {
          type: "text",
          text: `Analyze text content. Output JSON only. Content: ${textContent.substring(0, 4000)}`,
        },
      ];
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: messageContent }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(response.choices[0].message.content);
    const counterField = data.isTechnicalSheet
      ? "totalTechnicalSheets"
      : "totalProductImages";

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_USERS,
        Key: {
          tenantId: tenantId.toString(),
          email: email.toLowerCase().trim(),
        },
        UpdateExpression: `ADD ${counterField} :inc SET updatedAt = :u`,
        ExpressionAttributeValues: {
          ":inc": 1,
          ":u": new Date().toISOString(),
        },
      }),
    );

    res.status(200).json(data);
  } catch (e) {
    console.error("❌ analyzeProductImage Error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  console.log("⚙️ Iniciando setupAssistant para tenantId:", tenantId);

  if (!tenantId)
    return res.status(400).json({ message: "tenantId es obligatorio" });

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    let Item = Items?.[0];
    let currentAgentId = Item?.agentId || uuidv4();
    const existingFileIds = Item?.openaiFileIds || [];
    const existingFileNames = Item?.fileNames || [];

    const newFileIds = [];
    const newFileNames = [];
    let countFichas = 0;
    let countImages = 0;

    for (const file of files) {
      if (existingFileNames.includes(file.originalname)) continue;

      const fileStream = await OpenAI.toFile(file.buffer, file.originalname);
      const uploadResponse = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });

      newFileIds.push(uploadResponse.id);
      newFileNames.push(file.originalname);
      countFichas++;
    }

    const finalFileIds = [...existingFileIds, ...newFileIds];
    const finalFileNames = [...existingFileNames, ...newFileNames];
    let openaiId = Item?.openaiAssistantId;

    const instructions = `Eres Riley, soporte inteligente de ${company || "la empresa"}. Usa tus herramientas para ayudar al usuario.`;
    const tools = [
      { type: "file_search" },
      {
        type: "function",
        function: {
          name: "create_task",
          parameters: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              tenantId: { type: "string" },
            },
            required: ["titulo", "tenantId"],
          },
        },
      },
    ];

    if (!openaiId) {
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions,
        model: "gpt-4o",
        tools,
      });
      openaiId = assistant.id;
    } else {
      await openai.beta.assistants.update(openaiId, { instructions, tools });
    }

    if (newFileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}`,
        file_ids: finalFileIds,
      });
      await openai.beta.assistants.update(openaiId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId.toString(), agentId: currentAgentId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, assistantId = :va, openaiFileIds = :f, fileNames = :fn, updatedAt = :u, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":oa": openaiId,
          ":va": vapiAssistantId || "default-vapi-id",
          ":f": finalFileIds,
          ":fn": finalFileNames,
          ":u": new Date().toISOString(),
          ":c": company || "Empresa Genérica",
          ":e": email.toLowerCase(),
        },
      }),
    );

    console.log("✅ Setup finalizado correctamente.");
    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    console.error("❌ Error en setupAssistant:", e);
    res.status(500).json({ error: e.message });
  }
};
