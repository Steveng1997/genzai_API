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

exports.getConfig = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );
    res.status(200).json(Item || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updatePrompt = async (req, res) => {
  const { tenantId, systemPrompt, company, email } = req.body;
  if (!tenantId || systemPrompt === undefined) {
    return res
      .status(400)
      .json({ message: "tenantId y systemPrompt son requeridos." });
  }
  try {
    const endPrompt = Array.isArray(systemPrompt)
      ? systemPrompt
      : [systemPrompt.toString().trim()];
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET systemPrompt = :p, updatedAt = :u, tenantId = :t, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":p": endPrompt,
          ":u": new Date().toISOString(),
          ":t": tenantId,
          ":c": company || "",
          ":e": (email || "").toLowerCase(),
        },
      }),
    );
    res
      .status(200)
      .json({ success: true, message: "Instrucciones actualizadas." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.editPrompt = async (req, res) => {
  const { tenantId, systemPrompt } = req.body;
  if (!tenantId || !Array.isArray(systemPrompt)) {
    return res
      .status(400)
      .json({ message: "tenantId y un array son requeridos." });
  }
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression: "SET systemPrompt = :p, updatedAt = :u",
        ExpressionAttributeValues: {
          ":p": systemPrompt,
          ":u": new Date().toISOString(),
        },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.askRiley = async (req, res) => {
  const { message, tenantId } = req.body;

  if (!message || !tenantId) {
    return res.status(400).json({ error: "Faltan datos (message o tenantId)" });
  }

  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    const assistantId = Item?.openaiAssistantId;
    if (!assistantId) {
      return res
        .status(404)
        .json({ error: "Asistente no configurado para este tenant." });
    }

    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
    });

    if (run.status === "completed") {
      const messages = await openai.beta.threads.messages.list(thread.id);
      const reply = messages.data[0].content[0].text.value;
      res.status(200).json({ reply });
    } else {
      res.status(500).json({ error: `Run finalizó con estado: ${run.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  tenantId = (tenantId || "").trim();

  if (!tenantId) return res.status(400).json({ message: "Falta el tenantId." });

  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    const existingFileNames = Item?.fileNames || [];
    const existingFileIds = Item?.openaiFileIds || [];

    const newFileIds = [];
    const newFileNames = [];

    for (const file of files) {
      if (existingFileNames.includes(file.originalname)) {
        console.log(
          `El archivo ${file.originalname} ya existe. Saltando subida.`,
        );
        continue;
      }

      const fileStream = await OpenAI.toFile(file.buffer, file.originalname);
      const uploadResponse = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      newFileIds.push(uploadResponse.id);
      newFileNames.push(file.originalname);
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
          description: "Registra compromiso.",
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

    const instructionsText = Array.isArray(Item?.systemPrompt)
      ? Item.systemPrompt.join(". ")
      : Item?.systemPrompt || "Eres un asistente virtual.";

    if (!openaiId) {
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company || "Empresa"}`,
        instructions: `Eres Riley de "${company || "la empresa"}". Instrucciones: ${instructionsText}`,
        model: "gpt-4o",
        tools: assistantTools,
      });
      openaiId = assistant.id;
    } else {
      await openai.beta.assistants.update(openaiId, {
        instructions: `Eres Riley de "${company || "la empresa"}". Instrucciones: ${instructionsText}`,
        tools: assistantTools,
      });
    }

    if (finalFileIds.length > 0) {
      let vectorStoreId;
      try {
        const vectorStore = await openai.beta.vectorStores.create({
          name: `Store-${tenantId}`,
          file_ids: finalFileIds,
        });
        vectorStoreId = vectorStore.id;
      } catch (sdkError) {
        const vsResponse = await axios.post(
          "https://api.openai.com/v1/vector_stores",
          { name: `Store-${tenantId}`, file_ids: finalFileIds },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
              "OpenAI-Beta": "assistants=v2",
            },
          },
        );
        vectorStoreId = vsResponse.data.id;
      }

      try {
        await openai.beta.assistants.update(openaiId, {
          tool_resources: {
            file_search: { vector_store_ids: [vectorStoreId] },
          },
        });
      } catch (vincError) {
        await axios.post(
          `https://api.openai.com/v1/assistants/${openaiId}`,
          {
            tool_resources: {
              file_search: { vector_store_ids: [vectorStoreId] },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
              "OpenAI-Beta": "assistants=v2",
            },
          },
        );
      }
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, assistantId = :va, vapiPhoneNumberId = :vpi, openaiFileIds = :f, fileNames = :fn, updatedAt = :u, company = :c, ownerEmail = :e, tenantId = :t",
        ExpressionAttributeValues: {
          ":oa": openaiId,
          ":va": vapiAssistantId || "4c266662-68db-4046-a13f-8c021c84919c",
          ":vpi": "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          ":f": finalFileIds,
          ":fn": finalFileNames,
          ":u": new Date().toISOString(),
          ":c": company || Item?.company || "Sin Empresa",
          ":e": (email || Item?.ownerEmail || "").toLowerCase(),
          ":t": tenantId,
        },
      }),
    );

    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
