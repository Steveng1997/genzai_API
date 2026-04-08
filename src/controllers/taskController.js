const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_TASKS = process.env.DYNAMODB_TABLE_TASK || "Tasks";
const TABLE_HISTORY =
  process.env.DYNAMODB_TABLE_HISTORY || "ConsumptionHistory";
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.getTasks = async (req, res) => {
  const { company } = req.query;
  try {
    const data = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_TASKS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );
    res.status(200).json(data.Items || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.completeTask = async (req, res) => {
  const { taskId, isCompleted } = req.body;
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_TASKS,
        Key: { taskId: taskId },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.handleRileyTool = async (req, res) => {
  try {
    const payload = req.body.message || req.body;
    const toolCall = payload.toolCalls?.[0] || payload.toolCallList?.[0];
    if (!toolCall) return res.status(400).json({ error: "No tool call data" });

    const { titulo, detalle, company } = toolCall.function.arguments;

    const newTask = {
      taskId: `T-${Date.now()}`,
      company,
      title: titulo,
      description: detalle || "Sin detalles",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
    );
    return res.status(200).json({
      results: [{ toolCallId: toolCall.id, result: "Tarea guardada." }],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report")
    return res.status(200).json({ message: "Ignorado" });

  try {
    const { call, summary } = payload;
    const company = call?.metadata?.company || "unknown";

    const duration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const phone = call?.customer?.number || "N/A";
    const name = call?.customer?.name || "Cliente";

    const wasAnswered = duration > 0 || (summary && summary.length > 5);

    const finalSummary = wasAnswered
      ? summary || "Llamada finalizada"
      : "Llamada no contestada";

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          company,
          phone,
          duration,
          timestamp: new Date().toISOString(),
          summary: finalSummary,
          answered: wasAnswered,
        },
      }),
    );

    if (wasAnswered && summary) {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: `CALL-${Date.now()}`,
            company,
            title: `📞 Llamada: ${name}`,
            description: summary,
            isCompleted: true,
            createdAt: new Date().toISOString(),
            source: "Vapi Webhook",
          },
        }),
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(200).json({ error: error.message });
  }
};

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;

  try {
    if (!company)
      return res.status(400).json({ message: "Compañía requerida" });

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: company },
      }),
    );

    if (!config)
      return res.status(404).json({ message: "No hay IA configurada" });

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    if (!clientes || clientes.length === 0)
      return res.status(404).json({ message: "No hay clientes" });

    const calls = clientes.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: cliente.fullName,
            },
            assistantId: config.assistantId,
            phoneNumberId:
              process.env.VAPI_PHONE_NUMBER_ID ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
            metadata: { company },
          },
          {
            headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
          },
        );

        return response.data;
      } catch (err) {
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);

    res.status(200).json({
      success: true,
      message: `Proceso terminado para ${clientes.length} clientes en ${company}`,
      results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
