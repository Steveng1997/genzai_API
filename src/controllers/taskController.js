const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const TABLE_TASKS = process.env.DYNAMODB_TABLE_TASK || "Tasks";
const TABLE_HISTORY =
  process.env.DYNAMODB_TABLE_HISTORY || "ConsumptionHistory";

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
    res.status(200).json(data.Items);
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
      taskId: Date.now(),
      company: company, // Tarea asociada a la compañía
      title: titulo,
      description: detalle || "Sin detalles adicionales",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
    );

    return res.status(200).json({
      results: [
        { toolCallId: toolCall.id, result: "Tarea guardada exitosamente." },
      ],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report")
    return res.status(200).json({ message: "Evento ignorado" });

  try {
    const { call } = payload;
    const metadata = call?.metadata || {};

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          company: metadata.company || "unknown", // Registro por compañía
          phone: call?.customer?.number || "N/A",
          duration: call?.durationSeconds || 0,
          timestamp: new Date().toISOString(),
        },
      }),
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(200).json({ error: error.message });
  }
};
