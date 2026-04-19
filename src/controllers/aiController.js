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
  console.log("LOG: getConfig INICIO - tenantId:", req.params.tenantId);
  const { tenantId } = req.params;
  try {
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );
    console.log("LOG: getConfig DynamoDB EXITO - Item:", JSON.stringify(Item));
    res.status(200).json(Item || {});
  } catch (e) {
    console.log("LOG ERROR: getConfig FALLO:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.updatePrompt = async (req, res) => {
  console.log("LOG: updatePrompt INICIO - Body:", JSON.stringify(req.body));
  const { tenantId, systemPrompt, company, email } = req.body;
  if (!tenantId || systemPrompt === undefined) {
    console.log("LOG: updatePrompt ERROR VALIDACION");
    return res
      .status(400)
      .json({ message: "tenantId y systemPrompt son requeridos." });
  }
  try {
    const finalPrompt = Array.isArray(systemPrompt)
      ? systemPrompt
      : [systemPrompt.toString().trim()];
    console.log("LOG: updatePrompt PROCESANDO - finalPrompt:", finalPrompt);
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
    console.log("LOG: updatePrompt DynamoDB EXITO");
    res
      .status(200)
      .json({ success: true, message: "Instrucciones actualizadas." });
  } catch (e) {
    console.log("LOG ERROR: updatePrompt FALLO:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.editPrompt = async (req, res) => {
  console.log("LOG: editPrompt INICIO - Body:", JSON.stringify(req.body));
  const { tenantId, systemPrompt } = req.body;
  if (!tenantId || !Array.isArray(systemPrompt)) {
    console.log("LOG: editPrompt ERROR VALIDACION");
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
    console.log("LOG: editPrompt DynamoDB EXITO");
    res.status(200).json({ success: true });
  } catch (e) {
    console.log("LOG ERROR: editPrompt FALLO:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  console.log("LOG: setupAssistant TOTAL INICIO");
  const files = req.files || [];
  let { email, company, tenantId, vapiAssistantId } = req.body;
  tenantId = (tenantId || "").trim();

  console.log("LOG: setupAssistant DATA RECIBIDA:", {
    email,
    company,
    tenantId,
    vapiAssistantId,
    filesCount: files.length,
  });

  if (!tenantId) {
    console.log("LOG: setupAssistant ERROR - FALTA tenantId");
    return res.status(400).json({ message: "Falta el tenantId." });
  }

  try {
    console.log("LOG: setupAssistant CONSULTANDO DYNAMO...");
    const { Item } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );
    console.log("LOG: setupAssistant DYNAMO RESULT:", JSON.stringify(Item));

    const fileIds = [];
    for (const file of files) {
      console.log("LOG: setupAssistant SUBIENDO ARCHIVO:", file.originalname);
      const fileStream = await OpenAI.toFile(file.buffer, file.originalname);
      const uploadResponse = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      console.log("LOG: setupAssistant OPENAI FILE ID:", uploadResponse.id);
      fileIds.push(uploadResponse.id);
    }

    let openaiId = Item?.openaiAssistantId;
    console.log("LOG: setupAssistant openaiId ACTUAL:", openaiId);

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
    console.log("LOG: setupAssistant INSTRUCCIONES:", instructionsText);

    if (!openaiId) {
      console.log("LOG: setupAssistant CREANDO NUEVO ASISTENTE...");
      const assistant = await openai.beta.assistants.create({
        name: `Riley - ${company}`,
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        model: "gpt-4o",
        tools: assistantTools,
      });
      openaiId = assistant.id;
      console.log("LOG: setupAssistant NUEVO ID ASISTENTE:", openaiId);
    } else {
      console.log(
        "LOG: setupAssistant ACTUALIZANDO ASISTENTE EXISTENTE:",
        openaiId,
      );
      await openai.beta.assistants.update(openaiId, {
        instructions: `Eres Riley de "${company}". Instrucciones: ${instructionsText}`,
        tools: assistantTools,
      });
      console.log("LOG: setupAssistant ASISTENTE ACTUALIZADO");
    }

    if (fileIds.length > 0) {
      console.log("LOG: setupAssistant VALIDANDO OBJETO VECTORSTORES...");
      if (!openai.beta.vectorStores) {
        console.log(
          "LOG: setupAssistant ERROR CRITICO - vectorStores es UNDEFINED en el SDK de OpenAI",
        );
        throw new Error(
          "El SDK de OpenAI no tiene soporte para vectorStores. Ejecuta 'npm install openai@latest'",
        );
      }

      console.log("LOG: setupAssistant CREANDO VECTOR STORE...");
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Store-${tenantId}`,
        file_ids: fileIds,
      });
      console.log(
        "LOG: setupAssistant VECTOR STORE CREADO ID:",
        vectorStore.id,
      );

      console.log(
        "LOG: setupAssistant VINCULANDO VECTOR STORE AL ASISTENTE...",
      );
      await openai.beta.assistants.update(openaiId, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
      });
      console.log("LOG: setupAssistant VINCULACION EXITOSA");
    }

    console.log("LOG: setupAssistant ACTUALIZANDO DYNAMO FINAL...");
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, assistantId = :va, vapiPhoneNumberId = :vpi, openaiFileIds = list_append(if_not_exists(openaiFileIds, :empty_list), :f), updatedAt = :u, company = :c, ownerEmail = :e, tenantId = :t",
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
    console.log("LOG: setupAssistant DYNAMO ACTUALIZADO CON EXITO");

    console.log("LOG: setupAssistant TERMINADO OK");
    res.status(200).json({ success: true, openaiId });
  } catch (e) {
    console.log("LOG ERROR CRITICO setupAssistant:", e.message);
    console.log("LOG STACK ERROR:", e.stack);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
