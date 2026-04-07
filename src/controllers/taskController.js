const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const TABLE_TASKS = "Tasks";
const TABLE_HISTORY = "ConsumptionHistory";

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
      taskId: `TASK-${Date.now()}`,
      company: company,
      title: titulo,
      description: detalle || "Sin detalles",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
    );
    return res
      .status(200)
      .json({
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
    const { call, summary, transcript } = payload;
    const company = call?.metadata?.company || "unknown";

    const historyItem = {
      id: String(call?.id || Date.now()),
      company: company,
      phone: call?.customer?.number || "N/A",
      duration: call?.durationSeconds || 0,
      timestamp: new Date().toISOString(),
      summary: summary || "Sin resumen",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_HISTORY, Item: historyItem }),
    );

    if (summary) {
      const callTask = {
        taskId: `CALL-${Date.now()}`,
        company: company,
        title: `Llamada con ${call?.customer?.name || "Cliente"}`,
        description: summary,
        isCompleted: true,
        createdAt: new Date().toISOString(),
        source: "Vapi Webhook",
      };
      await dynamoDB.send(
        new PutCommand({ TableName: TABLE_TASKS, Item: callTask }),
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(200).json({ error: error.message });
  }
};
