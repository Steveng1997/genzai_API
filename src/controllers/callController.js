const axios = require("axios");
const {
  QueryCommand,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

// --- INICIAR LLAMADAS A CLIENTES HABILITADOS ---
exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Obtener el AssistantId configurado para este negocio
    const config = await dynamoDB.send(
      new GetCommand({
        TableName: "AIConfigs",
        Key: { businessId: businessId },
      }),
    );

    if (!config.Item?.assistantId) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Riley no configurada para este negocio.",
        });
    }

    // 2. Buscar solo clientes con el check activo (isEnabled === true)
    const clientsData = await dynamoDB.send(
      new QueryCommand({
        TableName: "Clients",
        KeyConditionExpression: "businessId = :bid",
        FilterExpression: "isEnabled = :checked",
        ExpressionAttributeValues: {
          ":bid": businessId,
          ":checked": true,
        },
      }),
    );

    const activeClients = clientsData.Items || [];

    if (activeClients.length === 0) {
      return res
        .status(200)
        .json({
          success: false,
          message: "No hay clientes seleccionados en la lista.",
        });
    }

    // 3. Lanzar llamadas vía Vapi
    let callsCount = 0;
    for (const client of activeClients) {
      const phone = client.phone || client.Phone || client.Celular; // Mapeo según tu captura
      if (phone) {
        try {
          await axios.post(
            "https://api.vapi.ai/call/phone",
            {
              customer: { number: phone, name: client.nombre || "Cliente" },
              assistantId: config.Item.assistantId,
              phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
              },
            },
          );
          callsCount++;
        } catch (err) {
          console.error(`Error al llamar a ${phone}:`, err.message);
        }
      }
    }

    res.status(200).json({ success: true, count: callsCount });
  } catch (error) {
    console.error("Error en makeSmartCall:", error);
    res
      .status(500)
      .json({ success: false, message: "Error interno del servidor" });
  }
};

// --- RECIBIR RESULTADOS DE VAPI (WEBHOOK) ---
exports.vapiWebhook = async (req, res) => {
  const { message } = req.body;

  // Solo procesamos cuando la llamada termina
  if (message?.type !== "end-of-call-report") return res.sendStatus(200);

  const customerPhone = message.customer?.number;
  const durationMin = parseFloat(
    ((message.durationSeconds || 0) / 60).toFixed(2),
  );
  const userEmail =
    message.assistant?.variableValues?.userEmail || "admin@genzai.com";

  try {
    // 1. Actualizar estado del cliente en la tabla
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Clients",
        Key: { Phone: customerPhone },
        UpdateExpression: "SET lastCallStatus = :s, lastCallAt = :t",
        ExpressionAttributeValues: {
          ":s": message.endedReason,
          ":t": new Date().toISOString(),
        },
      }),
    );

    // 2. Cobrar minutos al usuario si la llamada fue efectiva
    if (durationMin > 0) {
      await dynamoDB.send(
        new UpdateCommand({
          TableName: "Users",
          Key: { email: userEmail.toLowerCase().trim() },
          UpdateExpression:
            "SET minutos_disponibles = minutos_disponibles - :m",
          ExpressionAttributeValues: { ":m": durationMin },
        }),
      );
    }
  } catch (e) {
    console.error("Error procesando Webhook:", e);
  }

  res.sendStatus(200);
};
