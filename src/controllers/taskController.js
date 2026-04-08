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
    console.log("📥 Recibiendo solicitud en handleRileyTool");
    const payload = req.body.message || req.body;
    const toolCall =
      payload.toolCalls?.[0] || payload.toolCallList?.[0] || payload.toolCall;

    if (!toolCall) {
      console.error("❌ Error: No se encontró toolCall en el payload");
      return res.status(400).json({ error: "No tool call data" });
    }

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    const { titulo, detalle, company } = args;
    console.log(
      `📝 Intentando guardar tarea de Riley: ${titulo} para ${company}`,
    );

    const newTask = {
      taskId: `T-${Date.now()}`,
      company: company || "genzai",
      title: titulo || "Nueva Tarea",
      description: detalle || "Sin detalles",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
    );
    console.log("✅ Tarea de Riley guardada exitosamente en DynamoDB");

    return res.status(200).json({
      results: [
        { toolCallId: toolCall.id, result: "Tarea guardada correctamente." },
      ],
    });
  } catch (e) {
    console.error("❌ Error en handleRileyTool:", e.message);
    return res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report")
    return res.status(200).json({ message: "Ignorado" });

  try {
    console.log("📥 Recibiendo Webhook de Vapi (end-of-call-report)");
    const { call, summary } = payload;
    const company = call?.metadata?.company || "genzai";

    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const durationFormatted = formatDuration(rawDuration);

    const rawCost = Number(call?.cost || payload.cost || 0);
    const callCostRounded = Math.round((rawCost + Number.EPSILON) * 100) / 100;

    const phone = call?.customer?.number || "N/A";
    const name = call?.customer?.name || "Cliente";

    const wasAnswered = rawDuration > 0 || (summary && summary.length > 5);
    const finalSummary = wasAnswered
      ? summary || "Llamada finalizada"
      : "Llamada no contestada";

    console.log(
      `📊 Guardando historial: Duración ${durationFormatted}, Costo ${callCostRounded}`,
    );
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          company,
          phone,
          duration: durationFormatted,
          cost: callCostRounded,
          timestamp: new Date().toISOString(),
          summary: finalSummary,
          answered: wasAnswered,
        },
      }),
    );

    if (wasAnswered && summary) {
      console.log(
        `📝 Intentando guardar tarea automática desde Webhook para ${name}`,
      );
      const newTask = {
        taskId: `CALL-${Date.now()}`,
        company,
        title: `📞 Llamada: ${name}`,
        description: summary,
        isCompleted: true,
        createdAt: new Date().toISOString(),
        source: "Vapi Webhook",
      };

      await dynamoDB.send(
        new PutCommand({ TableName: TABLE_TASKS, Item: newTask }),
      );
      console.log("✅ Tarea de Webhook guardada exitosamente");
    } else {
      console.log(
        "ℹ️ No se creó tarea: La llamada no fue contestada o no hay resumen.",
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Error en handleVapiWebhook:", error.message);
    return res.status(500).json({ error: error.message });
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
            customer: { number: formattedPhone, name: cliente.fullName },
            assistantId: config.assistantId,
            phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
            metadata: { company },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );
        return response.data;
      } catch (err) {
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
