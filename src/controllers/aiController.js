const OpenAI = require("openai");
const {
  UpdateCommand,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TABLE_PAYMENTS = process.env.DYNAMODB_TABLE_PAYMENTS;
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
    const finalPrompt = Array.isArray(systemPrompt)
      ? systemPrompt
      : [systemPrompt.toString().trim()];

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET systemPrompt = :p, updatedAt = :u, tenantId = :t, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":p": finalPrompt,
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

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  tenantId = (tenantId || "").trim();

  if (!tenantId) {
    return res.status(400).json({ message: "Falta el tenantId." });
  }

  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    const fileIds = [];
    for (const file of files) {
      // CORRECCIÓN: Subida de archivos usando el buffer directamente (OpenAI v4)
      const uploadResponse = await openai.files.create({
        file: {
          url: file.originalname,
          blob: () => new Blob([file.buffer]),
        },
        purpose: "assistants",
      });
      fileIds.push(uploadResponse.id);
    }

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
      : Item?.systemPrompt || "";

    if (!openaiId) {
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        model: "gpt-4o",
        tools: assistantTools,
      });
      openaiId = assistant.id;
    } else {
      await openai.beta.assistants.update(openaiId, {
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        tools: assistantTools,
      });
    }

    if (fileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Store-${tenantId}`,
        file_ids: fileIds,
      });

      await openai.beta.assistants.update(openaiId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression: `SET 
          openaiAssistantId = :oa, 
          assistantId = :va, 
          vapiPhoneNumberId = :vpi,
          openaiFileIds = list_append(if_not_exists(openaiFileIds, :empty_list), :f), 
          updatedAt = :u, 
          company = :c, 
          ownerEmail = :e, 
          tenantId = :t`,
        ExpressionAttributeValues: {
          ":oa": openaiId,
          ":va": vapiAssistantId || "4c266662-68db-4046-a13f-8c021c84919c",
          ":vpi": "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          ":f": fileIds,
          ":u": new Date().toISOString(),
          ":c": company || Item?.company || "",
          ":e": (email || Item?.ownerEmail || "").toLowerCase(),
          ":t": tenantId,
          ":empty_list": [],
        },
      }),
    );

    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    console.error("Error setupAssistant:", e);
    res.status(500).json({ error: e.message });
  }
};
