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
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_CLIENTS;

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

const getNextStep = (currentStatus) => {
  const steps = {
    NO_CONTESTO: "REINTENTAR LLAMADA",
    CONTACTO: "BRINDAR INFORMACION",
    INFORMACION: "IDENTIFICAR INTERES",
    INTERES: "AGENDAR CITA",
    CITA: "INICIAR NEGOCIACION",
    NEGOCIACION: "CERRAR VENTA",
    CIERRE: "VENTA FINALIZADA",
    PERDIDA: "NINGUNO",
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

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

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

// --- HANDLE VAPI WEBHOOK (CRITICAL SECTION) ---
exports.handleVapiWebhook = async (req, res) => {
  console.log("--- INICIO WEBHOOK VAPI ---");

  if (req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET_KEY) {
    console.error("Error: Secreto de VAPI inválido");
    return res.status(401).send();
  }

  const payload = req.body.message || req.body;
  console.log("Tipo de Payload:", payload.type);

  if (payload.type !== "end-of-call-report") {
    return res.status(200).json({ message: "Ignorado" });
  }

  try {
    const { call, summary: vapiSummary, analysis } = payload;

    // Log de Metadata - AQUÍ ES DONDE SUELE FALLAR
    const metadata = call?.metadata || {};
    console.log("Metadata extraída:", JSON.stringify(metadata, null, 2));

    const tenantId = metadata.tenantId;
    const clientId = metadata.clientId;
    const company = metadata.company;
    const userEmail = metadata.email;
    const customerName = call?.customer?.name || "Cliente";

    console.log(
      `IDs detectados -> tenantId: ${tenantId}, clientId: ${clientId}`,
    );

    const globalInteractionDate = new Date().toISOString();
    const rawDuration = Number(
      call?.durationSeconds || payload.durationSeconds || 0,
    );
    const rawCost = Number(call?.cost || payload.cost || 0);
    const endedReason = call?.endedReason || "";

    const failureReasons = [
      "voicemail",
      "no-answer",
      "busy",
      "failed",
      "declined",
    ];
    let wasAnswered = !failureReasons.includes(endedReason) && rawDuration > 10;

    // Sobrescritura por IA
    if (analysis?.structuredData?.status === "NO_CONTESTO") {
      console.log("La IA marcó la llamada como NO_CONTESTO.");
      wasAnswered = false;
    }

    const statusMap = {
      NO_ANSWER: "NO_CONTESTO",
      CONTACT: "CONTACTO",
      INFORMATION: "INFORMACION",
      INTERESTED: "INTERES",
      APPOINTMENT: "CITA",
      NEGOTIATION: "NEGOCIACION",
      CLOSED: "CIERRE",
      LOST: "PERDIDA",
    };

    let negotiationStatus =
      statusMap[analysis?.structuredData?.status] ||
      (wasAnswered ? "CONTACTO" : "NO_CONTESTO");
    const progress =
      analysis?.structuredData?.progress || (wasAnswered ? 10 : 0);
    const nextStep = getNextStep(negotiationStatus);
    const minutesToSubtract = Math.round(rawDuration / 60);

    const finalSummaryText = wasAnswered
      ? vapiSummary || "Llamada contestada sin resumen detallado."
      : `Llamada no exitosa. Motivo: ${endedReason}`;

    console.log(`Estado final: ${negotiationStatus}, Answered: ${wasAnswered}`);

    // 1. Guardar en Historial
    console.log("Ejecutando: Guardar Historial...");
    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_HISTORY,
        Item: {
          id: String(call?.id || Date.now()),
          tenantId: tenantId ? String(tenantId).trim() : "SIN_TENANT",
          clientId: clientId ? String(clientId).trim() : "N/A",
          customerName,
          company: company || "N/A",
          phone: call?.customer?.number || "N/A",
          duration: formatDuration(rawDuration),
          cost: Math.round((rawCost + Number.EPSILON) * 100) / 100,
          timestamp: globalInteractionDate,
          summary: finalSummaryText,
          answered: wasAnswered,
        },
      }),
    );

    console.log(
      `El valor de del tenantId al actualizar el cliente ${tenantId}`,
    );
    console.log(
      `El valor de del clientId al actualizar el cliente ${clientId}`,
    );
    // 2. Actualizar Cliente
    if (tenantId && clientId) {
      console.log(`Ejecutando: Actualizar Cliente ${clientId}...`);
      await dynamoDB
        .send(
          new UpdateCommand({
            TableName: TABLE_CLIENTS,
            Key: {
              tenantId: String(tenantId).trim(),
              clientId: String(clientId).trim(),
            },
            UpdateExpression:
              "SET #st = :s, #pr = :p, #nx = :n, updatedAt = :u",
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
        )
        .then(() => console.log("Cliente actualizado con éxito."))
        .catch((err) =>
          console.error("Error actualizando cliente:", err.message),
        );
    } else {
      console.warn(
        "Saltando actualización de cliente: tenantId o clientId faltantes.",
      );
    }

    console.log(`El valor de del correo al descontar los minutos ${userEmail}`);
    console.log(
      `El valor de wasAnswered al descontar los minutos ${wasAnswered}`,
    );
    // 3. Descontar Minutos
    if (wasAnswered && userEmail && userEmail !== "sin-email") {
      console.log(`Ejecutando: Descontar minutos a ${userEmail}...`);
      const { Item: user } = await dynamoDB.send(
        new GetCommand({ TableName: TABLE_USERS, Key: { email: userEmail } }),
      );
      if (user) {
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

    console.log(`El valor de del tenantId al crear la tarea ${tenantId}`);
    console.log(`El valor de wasAnswered al crear la tarea ${wasAnswered}`);
    // 4. Crear Tarea de Seguimiento
    if (tenantId && (wasAnswered || analysis?.structuredData?.status)) {
      console.log("Ejecutando: Crear Tarea de Seguimiento...");
      await dynamoDB
        .send(
          new PutCommand({
            TableName: TABLE_TASKS,
            Item: {
              taskId: Date.now(),
              tenantId: String(tenantId).trim(),
              clientId: clientId ? String(clientId).trim() : "N/A",
              customerName: customerName,
              company: company || "N/A",
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
        )
        .then(() => console.log("Tarea creada con éxito."))
        .catch((err) => console.error("Error creando tarea:", err.message));
    } else {
      console.warn(
        "Condición de tarea no cumplida (Answered false o falta TenantId).",
      );
    }

    console.log("--- WEBHOOK FINALIZADO CON ÉXITO ---");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("!!! ERROR CRÍTICO EN WEBHOOK !!!");
    console.error(error);
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
