const OpenAI = require("openai");
const {
  PutCommand,
  UpdateCommand,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_PAYMENTS = process.env.DYNAMODB_TABLE_PAYMENTS || "Payments";
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";

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
      message: "Instrucciones acumuladas correctamente.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  try {
    let { email, company, tenantId } = req.body;
    tenantId = (tenantId || "").trim();

    if (!tenantId) {
      return res
        .status(400)
        .json({ message: "Falta el identificador de instancia (tenantId)." });
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

    let assistantId = Item?.openaiAssistantId;

    if (!assistantId) {
      const paymentsResponse = await dynamoDB.send(
        new ScanCommand({
          TableName: TABLE_PAYMENTS,
          FilterExpression: "tenantId = :t",
          ExpressionAttributeValues: { ":t": tenantId },
        }),
      );

      const businessData = paymentsResponse.Items && paymentsResponse.Items[0];
      const productDescription = businessData
        ? businessData.sellingProduct
        : "productos generales";

      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions: `Eres Riley, el asistente virtual de "${company}". Info: ${productDescription}. Usa 'create_task' para citas. tenantId: ${tenantId}.`,
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
                  titulo: { type: "string", description: "Resumen corto" },
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
      assistantId = assistant.id;
    }

    if (fileIds.length > 0) {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Store-${tenantId}`,
        file_ids: fileIds,
      });

      await openai.beta.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET openaiAssistantId = :a, openaiFileIds = list_append(if_not_exists(openaiFileIds, :empty_list), :f), updatedAt = :u, company = :c, ownerEmail = :e, tenantId = :t",
        ExpressionAttributeValues: {
          ":a": assistantId,
          ":f": fileIds,
          ":u": new Date().toISOString(),
          ":c": company,
          ":e": email.toLowerCase(),
          ":t": tenantId,
          ":empty_list": [],
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: `Riley entrenada y actualizada para: ${tenantId}`,
    });
  } catch (e) {
    res.status(500).json({ message: "Error técnico", error: e.message });
  } finally {
    files.forEach((f) => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
  }
};
