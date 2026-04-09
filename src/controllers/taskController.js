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
    const { titulo, detalle, company } = args;

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_TASKS,
        Item: {
          taskId: Date.now(),
          company: company || "genzai",
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
    const company = call?.metadata?.company || "genzai";
    const userEmail = call?.metadata?.email;

    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);
    const wasAnswered = rawDuration > 0 || (summary && summary.length > 5);
    const minutesToSubtract = Math.round(rawDuration / 60);

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          company,
          phone: call?.customer?.number || "N/A",
          duration: formatDuration(rawDuration),
          cost: Math.round((rawCost + Number.EPSILON) * 100) / 100,
          timestamp: new Date().toISOString(),
          summary: wasAnswered
            ? summary || "Llamada finalizada"
            : "Llamada no contestada",
          answered: wasAnswered,
        },
      }),
    );

    if (wasAnswered && userEmail && userEmail !== "sin-email") {
      try {
        const { Item: user } = await dynamoDB.send(
          new GetCommand({
            TableName: TABLE_USERS,
            Key: { email: userEmail },
          }),
        );

        if (user) {
          const currentMinutesClean = Math.floor(
            Number(user.availableMinutes || 0),
          );
          const finalMinutes = currentMinutesClean - minutesToSubtract;

          await dynamoDB.send(
            new UpdateCommand({
              TableName: TABLE_USERS,
              Key: { email: userEmail },
              UpdateExpression: "SET availableMinutes = :m",
              ExpressionAttributeValues: { ":m": finalMinutes },
            }),
          );
        }
      } catch (dbErr) {
        console.error("❌ Error al actualizar minutos:", dbErr.message);
      }
    }

    if (wasAnswered && summary) {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: Date.now(),
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

exports.getUserProfile = async (req, res) => {
  const { email } = req.query;
  try {
    const userResult = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_USERS,
        Key: { email: email },
      }),
    );

    if (!userResult.Item)
      return res.status(404).json({ error: "Usuario no encontrado" });

    const user = userResult.Item;
    const tasksResult = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_TASKS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": user.company || "genzai" },
      }),
    );

    res.status(200).json({
      ...user,
      tasks: tasksResult.Items || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
