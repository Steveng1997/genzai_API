const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_PAYMENTS = "Payments";
const TABLE_AI_CONFIGS = "AIConfigs";

exports.updatePrompt = async (req, res) => {
  const { tenantId, systemPrompt } = req.body;

  if (!tenantId || systemPrompt === undefined) {
    return res
      .status(400)
      .json({ message: "tenantId y systemPrompt son requeridos." });
  }

  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET systemPrompt = if_not_exists(systemPrompt, :empty) + :p",
        ExpressionAttributeValues: {
          ":p": `\n- ${systemPrompt}`,
          ":empty": "",
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: "Nuevo conocimiento acumulado correctamente.",
    });
  } catch (e) {
    console.error("Error en updatePrompt:", e);
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  try {
    let { email, company, tenantId } = req.body;

    email = (email || "").toLowerCase().trim();
    company = (company || "").trim();
    tenantId = (tenantId || "").trim();

    if (!tenantId) {
      return res
        .status(400)
        .json({ message: "Falta el identificador de instancia (tenantId)." });
    }

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

    const fileIds = [];
    for (const file of files) {
      const uploadResponse = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(uploadResponse.id);
    }

    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company}`,
      instructions: `Eres Riley, el asistente virtual inteligente de la empresa "${company}". 
      Tu objetivo es ayudar a los clientes con información sobre: ${productDescription}.
      REGLA COSMICA: Si el cliente muestra interés en una cita, compra o contacto, usa la función 'create_task'.
      Bajo ninguna circunstancia pidas el ID al cliente. Usa internamente siempre: ${tenantId}.
      Es obligatorio pasar el tenantId y el nombre de la empresa a todas las funciones.`,
      model: "gpt-4o",
      tools: [
        { type: "file_search" },
        {
          type: "function",
          function: {
            name: "create_task",
            description: "Registra un compromiso o tarea en el sistema Genzai.",
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
      tool_resources: {
        file_search: {
          vector_stores: fileIds.length > 0 ? [{ file_ids: fileIds }] : [],
        },
      },
    });

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_AI_CONFIGS,
        Item: {
          businessId: tenantId,
          tenantId: tenantId,
          company: company,
          ownerEmail: email,
          openaiAssistantId: assistant.id,
          openaiFileIds: fileIds,
          assistantId: "4c266662-68db-4046-a13f-8c021c84919c",
          vapiPhoneNumberId: "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          product: productDescription,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({
      success: true,
      message: `Riley configurada correctamente bajo el ID: ${tenantId}`,
    });
  } catch (e) {
    res.status(500).json({ message: "Error técnico", error: e.message });
  } finally {
    files.forEach((f) => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
  }
};
