const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const TABLE_TASKS = process.env.DYNAMODB_TABLE_TASK || "Tasks";
const TABLE_HISTORY =
  process.env.DYNAMODB_TABLE_HISTORY || "ConsumptionHistory";

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
    console.error(`❌ Error en getTasks para ${company}:`, e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.completeTask = async (req, res) => {
  const { taskId, isCompleted } = req.body;
  console.log(`[Task] Actualizando taskId: ${taskId} a estado: ${isCompleted}`);
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_TASKS,
        Key: { taskId: Number(taskId) },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    console.log(`✅ Task ${taskId} actualizado.`);
    res.status(200).json({ success: true });
  } catch (e) {
    console.error(`❌ Error en completeTask ${taskId}:`, e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.handleRileyTool = async (req, res) => {
  try {
    console.log("📥 Recibiendo llamada de herramienta (Riley Tool)");
    const payload = req.body.message || req.body;
    const toolCall =
      payload.toolCalls?.[0] || payload.toolCallList?.[0] || payload.toolCall;

    if (!toolCall) {
      console.warn("⚠️ RileyTool: No se encontró toolCall en el payload");
      return res.status(400).json({ error: "No tool call data" });
    }

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    const { titulo, detalle, company } = args;

    console.log(`📝 Guardando tarea de Riley: ${titulo} para ${company}`);

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
    console.log("✅ Tarea de Riley guardada exitosamente.");
    return res.status(200).json({
      results: [{ toolCallId: toolCall.id, result: "Tarea guardada" }],
    });
  } catch (e) {
    console.error("🔥 Error en handleRileyTool:", e.message);
    return res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report")
    return res.status(200).json({ message: "Ignorado" });

  console.log(`📥 Webhook Vapi (End-of-Call): CallId ${payload.call?.id}`);

  try {
    const { call, summary } = payload;
    const company = call?.metadata?.company || "genzai";
    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);
    const wasAnswered = rawDuration > 0 || (summary && summary.length > 5);

    console.log(
      `📊 Datos de llamada: Duración ${rawDuration}s, Costo ${rawCost}, Respondida: ${wasAnswered}`,
    );

    console.log(`[DB] Guardando historial en ${TABLE_HISTORY}`);
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

    if (wasAnswered && summary) {
      console.log(
        `[DB] Guardando tarea automática por llamada contestada para ${company}`,
      );
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: Date.now(),
            company,
            title: `📞 Llamada: ${call?.customer?.name || "Cliente"}`,
            description: summary,
            isCompleted: true,
            createdAt: new Date().toISOString(),
            source: "Vapi Webhook",
          },
        }),
      );
      console.log("✅ Tarea automática guardada.");
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("🔥 Error en handleVapiWebhook:", error.message);
    return res.status(500).json({ error: error.message });
  }
};
