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

exports.handleRileyTool = async (req, res) => {
  try {
    const payload = req.body.message || req.body;
    const toolCall = payload.toolCalls?.[0] || payload.toolCallList?.[0];
    if (!toolCall) return res.status(400).json({ error: "No tool call" });

    const { titulo, detalle, company } = toolCall.function.arguments;

    const newTask = {
      taskId: `T-${Date.now()}`,
      company,
      title: titulo,
      description: detalle || "Generada por Riley",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley AI",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
    );
    return res
      .status(200)
      .json({
        results: [{ toolCallId: toolCall.id, result: "Tarea creada." }],
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report") return res.status(200).send();

  console.log(`[Webhook] Reporte de llamada recibido para ${payload.call?.id}`);

  try {
    const company = payload.call?.metadata?.company || "unknown";
    const summary = payload.summary || "Llamada finalizada sin resumen";

    // 1. Guardar en Historial
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: payload.call?.id || String(Date.now()),
          company,
          phone: payload.call?.customer?.number,
          duration: payload.call?.durationSeconds,
          timestamp: new Date().toISOString(),
        },
      }),
    );

    // 2. Crear Tarea de seguimiento
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_TASKS,
        Item: {
          taskId: `CALL-${Date.now()}`,
          company,
          title: `Resumen: ${payload.call?.customer?.name || "Cliente"}`,
          description: summary,
          isCompleted: true,
          createdAt: new Date().toISOString(),
          source: "Vapi Report",
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Webhook Error]", error);
    res.status(200).json({ error: error.message });
  }
};