const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_PAYMENTS = "Payments";
const TABLE_AI_CONFIGS = "AIConfigs";

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

    // 2. Buscamos la descripción del producto en los pagos usando el tenantId
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
      instructions: `Eres Riley, asistente virtual de la empresa "${company}" con ID ${tenantId}. 
      Tu especialidad: ${productDescription}. 
      REGLA: Si el cliente muestra interés real, usa 'create_task' para agendar. 
      IMPORTANTE: Siempre debes pasar el tenantId "${tenantId}" a la función create_task.`,
      model: "gpt-4o",
      tools: [
        { type: "file_search" },
        {
          type: "function",
          function: {
            name: "create_task",
            description: "Crea una tarea o compromiso en el CRM.",
            parameters: {
              type: "object",
              properties: {
                titulo: { type: "string", description: "Resumen de la tarea" },
                detalle: { type: "string", description: "Descripción amplia" },
                tenantId: { type: "string", enum: [tenantId] }, // Forzamos a que use EL MISMO ID
              },
              required: ["titulo", "tenantId"],
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
