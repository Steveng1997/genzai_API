const OpenAI = require("openai");
const {
  UpdateCommand,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_PAYMENTS = process.env.DYNAMODB_TABLE_PAYMENTS;
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;

exports.updatePrompt = async (req, res) => {
  const { tenantId, systemPrompt } = req.body;

  if (!tenantId || systemPrompt === undefined) {
    return res
      .status(400)
      .json({ message: "tenantId y systemPrompt son requeridos." });
  }

  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    let currentPrompt = Item?.systemPrompt || "";
    let newFullPrompt =
      currentPrompt === ""
        ? `- ${systemPrompt}`
        : `${currentPrompt}\n- ${systemPrompt}`;

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression: "SET systemPrompt = :p",
        ExpressionAttributeValues: { ":p": newFullPrompt },
      }),
    );

    res.status(200).json({
      success: true,
      message: "Instrucciones acumuladas.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  try {
    let { email, company, tenantId, vapiAssistantId } = req.body;
    tenantId = (tenantId || "").trim();

    if (!tenantId) {
      if (files.length > 0) {
        files.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
      }
      return res.status(400).json({ message: "Falta el tenantId." });
    }

    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    const fileIds = [];
    for (const file of files) {
      const uploadResponse = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(uploadResponse.id);
    }

    let openaiId = Item?.openaiAssistantId;
    if (!openaiId) {
      const payments = await dynamoDB.send(
        new ScanCommand({
          TableName: TABLE_PAYMENTS,
          FilterExpression: "tenantId = :t",
          ExpressionAttributeValues: { ":t": tenantId },
        }),
      );
      const productDescription =
        payments.Items?.[0]?.sellingProduct || "productos generales";

      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions: `Eres Riley de "${company}". Info: ${productDescription}.`,
        model: "gpt-4o",
        tools: [
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
                  detalle: {
                    type: "string",
                    description: "Explicación detallada",
                  },
                  company: { type: "string", enum: [company] },
                  tenantId: { type: "string", enum: [tenantId] },
                },
                required: ["titulo", "tenantId", "company"],
              },
            },
          },
        ],
      });
      openaiId = assistant.id;
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
          ":c": company || "",
          ":e": (email || "").toLowerCase(),
          ":t": tenantId,
          ":empty_list": [],
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: "Riley configurada y IDs de Vapi vinculados.",
    });
  } catch (e) {
    res.status(500).json({ message: "Error técnico", error: e.message });
  } finally {
    files.forEach((f) => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
  }
};
