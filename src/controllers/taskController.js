const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const TABLE_TASKS = process.env.DYNAMODB_TABLE_TASK;
const TABLE_HISTORY = process.env.DYNAMODB_TABLE_HISTORY;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

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

exports.getTodayTasks = async (req, res) => {
  const { tenantId } = req.query;
  const today = new Date().toISOString().split("T")[0];
  try {
    const data = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_TASKS,
        FilterExpression: "tenantId = :t AND begins_with(createdAt, :today)",
        ExpressionAttributeValues: {
          ":t": (tenantId || "").trim(),
          ":today": today,
        },
      }),
    );
    res.status(200).json(data.Items || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.completeTask = async (req, res) => {
  const { taskId, isCompleted, tenantId } = req.body;
  try {
    if (!tenantId || !taskId) {
      return res
        .status(400)
        .json({ error: "Faltan parámetros: tenantId o taskId" });
    }
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_TASKS,
        Key: {
          tenantId: String(tenantId).trim(),
          taskId: Number(taskId),
        },
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
  if (req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET_KEY)
    return res.status(401).send();

  try {
    const payload = req.body.message || req.body;

    const toolCall =
      payload.toolCalls?.[0] || payload.toolCallList?.[0] || payload.toolCall;

    if (!toolCall) return res.status(400).json({ error: "No tool call data" });

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    const metadata = payload.call?.metadata || {};

    const taskItem = {
      taskId: Date.now(),
      tenantId: args.tenantId || metadata.tenantId,
      clientId: args.clientId || metadata.clientId,
      customerName: args.customerName || metadata.customerName || "Cliente",
      company: args.company || metadata.company,
      title: args.titulo || "Nueva Cita Agendada",
      description: args.detalle || "Sin detalles adicionales",
      isCompleted: false,
      createdAt: new Date().toISOString(),
      source: "Riley Assistant",
    };

    if (!taskItem.tenantId) {
      throw new Error("Missing tenantId in tool call or metadata");
    }

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_TASKS,
        Item: taskItem,
      }),
    );

    return res.status(200).json({
      results: [
        {
          toolCallId: toolCall.id,
          result: "Tarea agendada exitosamente en el sistema.",
        },
      ],
    });
  } catch (e) {
    console.error("Error en handleRileyTool:", e.message);
    return res.status(500).json({ error: e.message });
  }
};

exports.handleVapiWebhook = async (req, res) => {
  if (req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET_KEY)
    return res.status(401).send();

  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report")
    return res.status(200).json({ message: "Ignorado" });

  try {
    const { call, summary, analysis } = payload;
    const tenantId = call?.metadata?.tenantId;
    const company = call?.metadata?.company;
    const userEmail = call?.metadata?.email;
    const clientId = call?.metadata?.clientId;
    const customerName = call?.customer?.name || "Cliente";

    const globalInteractionDate = new Date().toISOString();

    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);

    const endedReason = call?.endedReason || "";

    // LISTA NEGRA DE MOTIVOS: Si la llamada terminó por estas razones, no fue contestada
    const failureReasons = [
      "voicemail",
      "no-answer",
      "busy",
      "failed",
      "customer-hung-up-erearly", // Si cuelgan antes de que la IA hable
      "declined",
    ];

    let wasAnswered = !failureReasons.includes(endedReason) && rawDuration > 10;

    if (analysis?.structuredData?.status === "NO_CONTESTO") {
      wasAnswered = false;
    }

    const minutesToSubtract = Math.round(rawDuration / 60);

    const negotiationStatus =
      analysis?.structuredData?.status ||
      (wasAnswered ? "INTERES" : "NO_CONTESTO");

    const progress =
      analysis?.structuredData?.progress || (wasAnswered ? 10 : 0);

    // 1. REGISTRO EN HISTORIAL LLAMADAS
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          tenantId,
          clientId,
          customerName,
          company,
          phone: call?.customer?.number || "N/A",
          duration: formatDuration(rawDuration),
          cost: Math.round((rawCost + Number.EPSILON) * 100) / 100,
          timestamp: globalInteractionDate,
          summary: wasAnswered
            ? summary || "Llamada finalizada"
            : `No contestada: ${endedReason}`,
          answered: wasAnswered,
          status: wasAnswered ? negotiationStatus : "NO_CONTESTO",
          progress: wasAnswered ? progress : 0,
        },
      }),
    );

    // 2. ACTUALIZACIÓN DEL STATUS EN LA TABLA CLIENTS
    if (wasAnswered && tenantId && clientId) {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CLIENTS,
          Key: {
            tenantId: String(tenantId).trim(),
            clientId: String(clientId).trim(),
          },
          UpdateExpression: "SET #st = :s, updatedAt = :u",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":s": negotiationStatus,
            ":p": progress,
            ":u": globalInteractionDate,
          },
        }),
      );
    }

    // 3. DESCUENTO DE MINUTOS
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

    // 4. CREACIÓN DE TAREA SI HUBO RESUMEN
    if (wasAnswered && summary) {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: Date.now(),
            tenantId,
            clientId,
            customerName,
            company,
            title: `📞 Llamada: ${customerName}`,
            description: summary,
            isCompleted: false,
            createdAt: globalInteractionDate,
            lastInteraction: globalInteractionDate,
            status: negotiationStatus,
            progress: progress,
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

exports.getHistoryCount = async (req, res) => {
  const { tenantId } = req.query;
  try {
    const response = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_HISTORY,
        FilterExpression: "tenantId = :t AND answered = :a",
        ExpressionAttributeValues: {
          ":t": (tenantId || "").trim(),
          ":a": false,
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
