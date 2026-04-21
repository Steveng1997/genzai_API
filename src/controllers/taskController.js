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
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS;

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

const getNextStep = (currentStatus) => {
  const steps = {
    No_contesto: "Reintentar llamada",
    Contacto: "Brindar información",
    Información: "Identificar interés",
    Interes: "Agendar cita",
    Cita: "Iniciar negociación",
    Negociación: "Cerrar venta",
    Cierre: "venta finalizada",
    Pérdida: "Ninguno",
  };
  return steps[currentStatus] || "SIN DEFINIR";
};

// --- GET TASKS ---
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

// --- GET TODAY TASKS ---
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

// --- COMPLETE TASK ---
exports.completeTask = async (req, res) => {
  const { taskId, isCompleted, tenantId } = req.body;
  try {
    if (!tenantId || !taskId) {
      return res.status(400).json({ error: "Faltan parámetros" });
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

// --- HANDLE RILEY TOOL ---
exports.handleRileyTool = async (req, res) => {
  if (req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET_KEY)
    return res.status(401).send();

  try {
    const payload = req.body.message || req.body;
    const toolCall =
      payload.toolCalls?.[0] || payload.toolCallList?.[0] || payload.toolCall;

    if (!toolCall) return res.status(400).json({ error: "No tool call data" });

    return res.status(200).json({
      results: [
        {
          toolCallId: toolCall.id,
          result:
            "Información procesada. La tarea se creará al finalizar la llamada.",
        },
      ],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// --- HANDLE VAPI WEBHOOK ---
exports.handleVapiWebhook = async (req, res) => {
  console.log("--- INICIO WEBHOOK VAPI ---");

  if (req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET_KEY) {
    console.error("Error: Secreto de VAPI inválido");
    return res.status(401).send();
  }

  const payload = req.body.message || req.body;
  if (payload.type !== "end-of-call-report") {
    return res.status(200).json({ message: "Ignorado" });
  }

  try {
    const { call, summary: vapiSummary, analysis } = payload;
    const metadata = call?.metadata || {};
    const tenantId = metadata.tenantId;
    const clientId = metadata.clientId;
    const userEmail = metadata.email;
    const customerName = call?.customer?.name || "Cliente";

    const globalInteractionDate = new Date().toISOString();
    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);
    const endedReason = call?.endedReason || "";

    // Lógica técnica básica (Solo para historial y minutos)
    const failureReasons = [
      "voicemail",
      "no-answer",
      "busy",
      "failed",
      "declined",
    ];
    const wasAnswered =
      !failureReasons.includes(endedReason) && rawDuration > 10;

    // --- LÓGICA BASADA EN IA (Riley) ---
    const structured = analysis?.structuredData || {};

    // Si Riley no entrega un estado, por defecto es "No_contesto"
    const negotiationStatus = structured.status || "No_contesto";

    // Si Riley no entrega progreso, por defecto es 0
    const progress = Number(structured.progress || 0);

    const nextStep = getNextStep(negotiationStatus);
    const finalSummaryText =
      structured.resumen ||
      structured.description ||
      vapiSummary ||
      "Sin resumen disponible.";

    // 1. Guardar en Historial
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          tenantId: tenantId ? String(tenantId).trim() : "SIN_TENANT",
          clientId: clientId ? String(clientId).trim() : "N/A",
          customerName,
          company: metadata.company || "N/A",
          phone: call?.customer?.number || "N/A",
          duration: formatDuration(rawDuration),
          cost: Math.round((rawCost + Number.EPSILON) * 100) / 100,
          timestamp: globalInteractionDate,
          summary: finalSummaryText,
          answered: wasAnswered,
        },
      }),
    );

    // 2. Actualizar Cliente
    if (tenantId && clientId) {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CLIENTS,
          Key: {
            tenantId: String(tenantId).trim(),
            clientId: String(clientId).trim(),
          },
          UpdateExpression: "SET #st = :s, #pr = :p, #nx = :n, updatedAt = :u",
          ExpressionAttributeNames: {
            "#st": "status",
            "#pr": "progress",
            "#nx": "nextStep",
          },
          ExpressionAttributeValues: {
            ":s": negotiationStatus,
            ":p": progress,
            ":n": nextStep,
            ":u": globalInteractionDate,
          },
        }),
      );
    }

    // 3. Descontar Minutos (Uso técnico de wasAnswered)
    if (wasAnswered && userEmail && userEmail !== "sin-email") {
      const { Item: user } = await dynamoDB.send(
        new GetCommand({ TableName: TABLE_USERS, Key: { email: userEmail } }),
      );
      if (user) {
        const minutesToSubtract = Math.round(rawDuration / 60);
        const finalMinutes =
          Math.floor(Number(user.availableMinutes || 0)) - minutesToSubtract;
        await dynamoDB.send(
          new UpdateCommand({
            Key: { email: userEmail },
            TableName: TABLE_USERS,
            UpdateExpression: "SET availableMinutes = :m",
            ExpressionAttributeValues: { ":m": finalMinutes },
          }),
        );
      }
    }

    // 4. Crear Tarea de Seguimiento
    if (tenantId) {
      await dynamoDB.send(
        new PutCommand({
          TableName: TABLE_TASKS,
          Item: {
            taskId: Date.now(),
            tenantId: String(tenantId).trim(),
            clientId: clientId ? String(clientId).trim() : "N/A",
            customerName,
            company: metadata.company || "N/A",
            title: `📞 Seguimiento: ${customerName}`,
            description: finalSummaryText,
            isCompleted: false,
            createdAt: globalInteractionDate,
            lastInteraction: globalInteractionDate,
            status: negotiationStatus,
            progress: progress,
            nextStep: nextStep,
            source: "Vapi Webhook",
          },
        }),
      );
    }

    console.log("--- WEBHOOK FINALIZADO CON ÉXITO ---");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("!!! ERROR CRÍTICO EN WEBHOOK !!!", error);
    return res.status(500).json({ error: error.message });
  }
};

// --- COUNTERS ---
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
