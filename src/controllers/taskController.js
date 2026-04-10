const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const TABLE_TASKS = process.env.DYNAMODB_TABLE_TASK || "Tasks";
const TABLE_HISTORY =
  process.env.DYNAMODB_TABLE_HISTORY || "ConsumptionHistory";
const TABLE_USERS = "Users";

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

exports.getTasks = async (req, res) => {
  let { tenantId } = req.query;
  try {
    const data = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_TASKS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": (tenantId || "").trim() },
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
        Key: { taskId: Number(taskId) },
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
    const toolCall =
      payload.toolCalls?.[0] || payload.toolCallList?.[0] || payload.toolCall;
    if (!toolCall) return res.status(400).json({ error: "No tool call data" });

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    const { titulo, detalle, company, tenantId } = args;

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_TASKS,
        Item: {
          taskId: Date.now(),
          tenantId,
          company,
          title: titulo || "Nueva Tarea",
          description: detalle || "Sin detalles",
          isCompleted: false,
          createdAt: new Date().toISOString(),
          source: "Riley Assistant",
        },
      }),
    );
    return res.status(200).json({
      results: [{ toolCallId: toolCall.id, result: "Tarea guardada" }],
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
    const tenantId = call?.metadata?.tenantId;
    const company = call?.metadata?.company;
    const userEmail = call?.metadata?.email;

    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);
    // Lógica para determinar si contestó
    const wasAnswered = rawDuration > 0 || (summary && summary.length > 5);
    const minutesToSubtract = Math.round(rawDuration / 60);

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          tenantId,
          company,
          phone: call?.customer?.number || "N/A",
          duration: formatDuration(rawDuration),
          cost: Math.round((rawCost + Number.EPSILON) * 100) / 100,
          timestamp: new Date().toISOString(),
          summary: wasAnswered ? summary : "Llamada no contestada",
          answered: !!wasAnswered,
        },
      }),
    );

    if (wasAnswered && userEmail && userEmail !== "sin-email") {
      const { Item: user } = await dynamoDB.send(
        new GetCommand({ TableName: TABLE_USERS, Key: { email: userEmail } }),
      );
      if (user) {
        const finalMinutes =
          Math.floor(Number(user.availableMinutes || 0)) - minutesToSubtract;
        await dynamoDB.send(
          new UpdateCommand({
            TableName: TABLE_USERS,
            Key: { email: userEmail },
            UpdateExpression: "SET availableMinutes = :m",
            ExpressionAttributeValues: { ":m": finalMinutes },
          }),
        );
      }
    }

    if (wasAnswered && summary) {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: Date.now(),
            tenantId,
            company,
            title: `📞 Llamada: ${call?.customer?.name || "Cliente"}`,
            description: summary,
            isCompleted: false,
            createdAt: new Date().toISOString(),
            source: "Vapi Webhook",
          },
        }),
      );
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// CONTADOR ACTUALIZADO PARA USAR EL CAMPO 'answered'
exports.getHistoryCount = async (req, res) => {
  const { tenantId } = req.query;
  try {
    const response = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_HISTORY,
        FilterExpression: "tenantId = :t AND answered = :a",
        ExpressionAttributeValues: {
          ":t": (tenantId || "").trim(),
          ":a": false, // Buscamos solo los que NO contestaron
        },
        Select: "COUNT",
      }),
    );
    res.status(200).json({ count: response.Count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTodayTasksCount = async (req, res) => {
  const { tenantId } = req.query;
  const today = new Date().toISOString().split("T")[0];
  try {
    const data = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_TASKS,
        FilterExpression:
          "tenantId = :t AND begins_with(createdAt, :today) AND isCompleted = :c",
        ExpressionAttributeValues: {
          ":t": (tenantId || "").trim(),
          ":today": today,
          ":c": false,
        },
        Select: "COUNT",
      }),
    );
    res.status(200).json({ count: data.Count || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
