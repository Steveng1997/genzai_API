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
      return res.status(404).json({ error: "Asistente no configurado." });
    }
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
      additional_instructions:
        "Responde siempre de forma directa y útil. Tienes permiso total para usar tu conocimiento general para responder cualquier pregunta del usuario.",
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

exports.analyzeProductImage = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const file = req.file;
    if (!file)
      return res.status(400).json({ error: "No image or document provided" });

    let messageContent = [];

    if (file.mimetype.startsWith("image/")) {
      const base64Image = file.buffer.toString("base64");
      messageContent = [
        {
          type: "text",
          text: `Analyze this inventory image.
          If it is a TECHNICAL SHEET (document with tables, measures, specs), respond: {"isTechnicalSheet": true, "name": "detected name"}.
          If it is a common PRODUCT, extract data and respond: {"isTechnicalSheet": false, "name": "name", "price": numeric_value, "description": "short", "category": "category"}.
          Respond only pure JSON, no markdown.`,
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
          text: `Analyze the content of this file (${file.originalname}).
          If it contains TECHNICAL SHEET data (tables, measures, specs), respond: {"isTechnicalSheet": true, "name": "detected name"}.
          If it describes a common PRODUCT, extract data and respond: {"isTechnicalSheet": false, "name": "name", "price": numeric_value, "description": "short", "category": "category"}.
          Respond only pure JSON, no markdown.
          Content: ${textContent.substring(0, 4000)}`,
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
        Key: { businessId: tenantId },
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
    let countFichas = 0;
    let countImagesNoFichas = 0;

    for (const file of files) {
      if (existingFileNames.includes(file.originalname)) continue;

      let isFicha = false;
      let analysisContent = [];

      if (file.mimetype.startsWith("image/")) {
        const base64Image = file.buffer.toString("base64");
        analysisContent = [
          {
            type: "text",
            text: 'Analyze if this image is a TECHNICAL SHEET (tables, measures, specs) or just a common PRODUCT photo. Respond: {"isTechnicalSheet": true/false}',
          },
          {
            type: "image_url",
            image_url: { url: `data:${file.mimetype};base64,${base64Image}` },
          },
        ];
      } else {
        analysisContent = [
          {
            type: "text",
            text: `Analyze the content of this file named "${file.originalname}". Determine if it is a TECHNICAL SHEET (product specifications, technical data, tables) or just a simple image/document that IS NOT a technical sheet. Respond: {"isTechnicalSheet": true/false}`,
          },
        ];
      }

      const analysis = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: analysisContent }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(analysis.choices[0].message.content);
      isFicha = result.isTechnicalSheet;

      if (isFicha) {
        countFichas++;
      } else {
        countImagesNoFichas++;
      }

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
          Key: { businessId: tenantId },
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
    const instructionsText = Array.isArray(Item?.systemPrompt)
      ? Item.systemPrompt.join(". ")
      : Item?.systemPrompt || "";
    const fullInstructions = `
      Eres Riley, un asistente de soporte inteligente y versátil de la empresa "${company || "la empresa"}".
      Tu objetivo es ser un soporte integral.
      Instrucciones adicionales: ${instructionsText}
    `.trim();
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
    if (finalFileIds.length > 0) {
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
          ":c": company || "Sin Empresa",
          ":e": (email || "").toLowerCase(),
          ":t": tenantId,
        },
      }),
    );
    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
