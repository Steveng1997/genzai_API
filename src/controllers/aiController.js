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
  console.log("LOG: getConfig iniciado para", tenantId);
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );
    console.log("LOG: getConfig exitoso");
    res.status(200).json(Item || {});
  } catch (e) {
    console.error("LOG ERROR: getConfig", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.updatePrompt = async (req, res) => {
  const { tenantId, systemPrompt, company, email } = req.body;
  console.log("LOG: updatePrompt iniciado para", tenantId);
  if (!tenantId || systemPrompt === undefined) {
    console.log("LOG: Faltan datos en updatePrompt");
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
    console.log("LOG: updatePrompt exitoso");
    res
      .status(200)
      .json({ success: true, message: "Instrucciones actualizadas." });
  } catch (e) {
    console.error("LOG ERROR: updatePrompt", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.editPrompt = async (req, res) => {
  const { tenantId, systemPrompt } = req.body;
  console.log("LOG: editPrompt iniciado para", tenantId);
  if (!tenantId || !Array.isArray(systemPrompt)) {
    console.log("LOG: Datos inválidos en editPrompt");
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
    console.log("LOG: editPrompt exitoso");
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("LOG ERROR: editPrompt", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  console.log("LOG: setupAssistant iniciado");
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  tenantId = (tenantId || "").trim();

  console.log("LOG: Body recibido", {
    email,
    company,
    tenantId,
    vapiAssistantId,
    filesCount: files.length,
  });

  if (!tenantId) {
    console.log("LOG: Error - Falta tenantId");
    return res.status(400).json({ message: "Falta el tenantId." });
  }

  try {
    console.log("LOG: Consultando DynamoDB...");
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    const fileIds = [];
    for (const file of files) {
      console.log("LOG: Subiendo archivo a OpenAI:", file.originalname);

      // --- CORRECCIÓN DEFINITIVA PARA OPENAI V4 ---
      // Usamos toFile para convertir el buffer en un archivo válido con nombre
      const fileStream = await OpenAI.toFile(file.buffer, file.originalname);

      const uploadResponse = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      // ---------------------------------------------

      console.log("LOG: Archivo subido con ID:", uploadResponse.id);
      fileIds.push(uploadResponse.id);
    }

    let openaiId = Item?.openaiAssistantId;
    console.log("LOG: openaiAssistantId existente:", openaiId);

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
      console.log("LOG: Creando nuevo asistente en OpenAI...");
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        model: "gpt-4o",
        tools: assistantTools,
      });
      openaiId = assistant.id;
      console.log("LOG: Nuevo asistente creado ID:", openaiId);
    } else {
      console.log("LOG: Actualizando asistente existente...");
      await openai.beta.assistants.update(openaiId, {
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        tools: assistantTools,
      });
      console.log("LOG: Asistente actualizado");
    }

    if (fileIds.length > 0) {
      console.log("LOG: Creando Vector Store...");
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Store-${tenantId}`,
        file_ids: fileIds,
      });
      console.log("LOG: Vector Store creado ID:", vectorStore.id);

      await openai.beta.assistants.update(openaiId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
      console.log("LOG: Vector Store vinculado al asistente");
    }

    console.log("LOG: Actualizando base de datos DynamoDB...");
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

    console.log("LOG: Proceso finalizado exitosamente");
    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    console.error("LOG ERROR CRITICO setupAssistant:", e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
