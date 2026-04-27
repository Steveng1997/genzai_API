const OpenAI = require("openai");
const axios = require("axios");
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
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId },
      }),
    );
    res.status(200).json(Item || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.askRiley = async (req, res) => {
  const { message, tenantId } = req.body;
  if (!message || !tenantId) {
    return res.status(400).json({ error: "Faltan datos" });
  }
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId },
      }),
    );
    const assistantId = Item?.openaiAssistantId;
    if (!assistantId) {
      return res.status(404).json({ error: "Asistente no configurado." });
    }
    let threadId = Item?.activeThreadId;
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CONFIGS,
          Key: { tenantId: tenantId },
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
      if (lastAssistantMessage && lastAssistantMessage.content[0]) {
        const reply = lastAssistantMessage.content[0].text.value;
        res.status(200).json({ reply });
      } else {
        res.status(200).json({ reply: "No se generó respuesta." });
      }
    } else {
      res.status(500).json({ error: run.status });
    }
  } catch (e) {
    console.error("❌ Error en askRiley:", e);
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });
    let messageContent = [];
    if (file.mimetype.startsWith("image/")) {
      const base64Image = file.buffer.toString("base64");
      messageContent = [
        {
          type: "text",
          text: `Analyze this image. If TECHNICAL SHEET: {"isTechnicalSheet": true, "name": "name"}. If common PRODUCT: {"isTechnicalSheet": false, "name": "name", "price": numeric, "description": "short", "category": "category"}. JSON only.`,
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
          text: `Analyze this file content (${file.originalname}). If TECHNICAL SHEET: {"isTechnicalSheet": true, "name": "name"}. If common PRODUCT: {"isTechnicalSheet": false, "name": "name", "price": numeric, "description": "short", "category": "category"}. JSON only. Content: ${textContent.substring(0, 4000)}`,
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
        Key: { tenantId: tenantId, email: email.toLowerCase().trim() },
        UpdateExpression: `ADD ${counterField} :inc SET updatedAt = :u`,
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

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  tenantId = (tenantId || "").trim();
  if (!tenantId) return res.status(400).json({ message: "Falta tenantId" });
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId },
      }),
    );
    const existingFileNames = Item?.fileNames || [];
    const existingFileIds = Item?.openaiFileIds || [];
    const newFileIds = [];
    const newFileNames = [];
    let countFichas = 0;
    let countImagesNoFichas = 0;
    for (const file of files) {
      if (existingFileNames.includes(file.originalname)) continue;
      let analysisContent = [];
      if (file.mimetype.startsWith("image/")) {
        const base64Image = file.buffer.toString("base64");
        analysisContent = [
          {
            type: "text",
            text: 'Analyze if this image is a TECHNICAL SHEET. Respond: {"isTechnicalSheet": true/false}',
          },
          {
            type: "image_url",
            image_url: { url: `data:${file.mimetype};base64,${base64Image}` },
          },
        ];
      } else {
        const textContent = file.buffer.toString("utf-8");
        analysisContent = [
          {
            type: "text",
            text: `Analyze the content of "${file.originalname}". Determine if it is a TECHNICAL SHEET. Respond: {"isTechnicalSheet": true/false}. Content: ${textContent.substring(0, 2000)}`,
          },
        ];
      }
      const analysis = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: analysisContent }],
        response_format: { type: "json_object" },
      });
      const result = JSON.parse(analysis.choices[0].message.content);
      if (result.isTechnicalSheet) countFichas++;
      else countImagesNoFichas++;
      const fileStream = await OpenAI.toFile(file.buffer, file.originalname);
      const uploadResponse = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      newFileIds.push(uploadResponse.id);
      newFileNames.push(file.originalname);
    }
    if (newFileIds.length > 0) {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_USERS,
          Key: { tenantId: tenantId, email: email.toLowerCase().trim() },
          UpdateExpression:
            "ADD totalTechnicalSheets :docs, totalProductImages :imgs SET updatedAt = :u",
          ExpressionAttributeValues: {
            ":docs": countFichas,
            ":imgs": countImagesNoFichas,
            ":u": new Date().toISOString(),
          },
        }),
      );
    }
    const finalFileIds = [...existingFileIds, ...newFileIds];
    const finalFileNames = [...existingFileNames, ...newFileNames];
    let openaiId = Item?.openaiAssistantId;
    const assistantTools = [
      { type: "file_search" },
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Registra un compromiso o tarea.",
          parameters: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              detalle: { type: "string" },
              company: { type: "string" },
              tenantId: { type: "string" },
            },
            required: ["titulo", "tenantId", "company"],
          },
        },
      },
    ];
    const fullInstructions = `Eres Riley, un asistente de soporte inteligente de la empresa "${company || "la empresa"}". Tu objetivo es ser un soporte integral.`;
    if (!openaiId) {
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company || "Empresa"}`,
        instructions: fullInstructions,
        model: "gpt-4o",
        tools: assistantTools,
      });
      openaiId = assistant.id;
    } else {
      await openai.beta.assistants.update(openaiId, {
        instructions: fullInstructions,
        tools: assistantTools,
      });
    }
    if (newFileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Store-${tenantId}`,
        file_ids: finalFileIds,
      });
      await openai.beta.assistants.update(openaiId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
    }
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, assistantId = :va, vapiPhoneNumberId = :vpi, openaiFileIds = :f, fileNames = :fn, updatedAt = :u, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":oa": openaiId,
          ":va": vapiAssistantId || "4c266662-68db-4046-a13f-8c021c84919c",
          ":vpi": "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          ":f": finalFileIds,
          ":fn": finalFileNames,
          ":u": new Date().toISOString(),
          ":c": company || "Sin Empresa",
          ":e": (email || "").toLowerCase(),
        },
      }),
    );
    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
