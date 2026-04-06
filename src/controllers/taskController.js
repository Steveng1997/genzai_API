const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// --- FUNCIONES PARA FLUTTER ---

// Obtener todas las tareas
exports.getTasks = async (req, res) => {
  try {
    const data = await dynamoDB.send(new ScanCommand({ TableName: "Tasks" }));
    res.status(200).json(data.Items);
  } catch (e) {
    console.error("❌ Error al obtener tareas:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// Actualizar estado de una tarea
exports.completeTask = async (req, res) => {
  const { taskId, isCompleted } = req.body;
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Tasks",
        Key: { taskId: taskId },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("❌ Error al actualizar tarea:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// --- WEBHOOK VAPI (CORREGIDO) ---

exports.handleVapiWebhook = async (req, res) => {
  console.log("-----------------------------------------");
  console.log("🔔 WEBHOOK ACTIVADO: Recibiendo datos de Vapi...");

  const payload = req.body.message || req.body;
  const { type, call } = payload;

  console.log("Tipo de evento:", type);

  try {
    // FILTRO: Solo procesamos el reporte final
    if (type !== "end-of-call-report") {
      return res.status(200).json({ message: "Evento ignorado" });
    }

    if (!call) {
      console.error("❌ No se recibió el objeto 'call' en el webhook");
      return res.status(200).json({ error: "No call data" });
    }

    const metadata = call.metadata || {};

    // --- EXTRACCIÓN ROBUSTA DE DATOS ---

    // 1. Duración: Buscamos en durationSeconds, luego en duration.
    const rawDuration = call.durationSeconds || call.duration || 0;
    const finalDuration = Math.round(Number(rawDuration));

    // 2. COSTO (MUY IMPORTANTE):
    // Vapi puede enviarlo en 'cost', 'totalCost' o dentro de 'analysis.cost'
    const finalCost = Number(
      call.cost || call.totalCost || (call.analysis && call.analysis.cost) || 0,
    );

    console.log(`💾 Guardando consumo para la llamada: ${call.id}`);
    console.log(
      `📊 Datos Finales -> Duración: ${finalDuration}s | Costo: ${finalCost}`,
    );

    // Registro en la base de datos
    await dynamoDB.send(
      new PutCommand({
        TableName: "ConsumptionHistory",
        Item: {
          id: String(call.id), // Forzamos String para evitar Type Mismatch
          businessId: metadata.businessId || "desconocido",
          businessName: metadata.businessName || "N/A",
          phone: call.customer?.number || "N/A",
          duration: `${finalDuration} seg`,
          cost: finalCost, // Guardado como número real para cálculos
          status: call.endedReason || "completed",
          timestamp: new Date().toISOString(),
        },
      }),
    );

    console.log("✅ Registro en ConsumptionHistory exitoso");
    console.log("-----------------------------------------");

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ ERROR CRÍTICO EN WEBHOOK:", error.message);
    // Respondemos 200 para que Vapi no marque error de servidor, pero logueamos el fallo
    return res.status(200).json({ error: error.message });
  }
};
