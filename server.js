require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN AWS ---
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Motivos de finalización que disparan el WhatsApp
const fallosLlamada = [
  "voicemail",
  "no-answer",
  "customer-did-not-answer",
  "machine-detected",
  "assistant-detected-voicemail",
  "rejected",
  "customer-ended",
];

// --- 1. VALIDACIÓN WEBHOOK META (GET) ---
app.get("/meta-webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook de Meta validado correctamente.");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// --- 2. WEBHOOK VAPI (POST) ---
app.post("/vapi-webhook", async (req, res) => {
  const { message } = req.body;

  if (message?.type === "end-of-call-report") {
    const phone = message.customer?.number || message.call?.customer?.number;
    const razon = message.endedReason;

    console.log(`🏁 Fin de llamada: ${phone} | Razón: ${razon}`);

    // Si la llamada no fue exitosa, disparamos WhatsApp
    if (fallosLlamada.includes(razon)) {
      await enviarWhatsApp(phone);
    }

    // Devolvemos a "Pendiente" en DynamoDB para seguimiento o re-intento
    await actualizarEstadoDB(phone, "Pendiente");
  }
  res.sendStatus(200);
});

// --- 3. FUNCIÓN ENVÍO WHATSAPP ---
async function enviarWhatsApp(phone) {
  const cleanPhone = phone.replace(/\D/g, "");

  // Saludo dinámico según hora Colombia
  const hora = new Date().getUTCHours() - 5;
  let saludo = "Buenas noches";
  if (hora >= 5 && hora < 12) saludo = "Buenos días";
  else if (hora >= 12 && hora < 18) saludo = "Buenas tardes";

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.META_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: process.env.META_TEMPLATE_NAME,
          language: { code: process.env.META_LANGUAGE_CODE || "es_CO" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: saludo }],
            },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${process.env.META_TOKEN}` } },
    );
    console.log(`📩 WhatsApp enviado a ${cleanPhone} (${saludo})`);
  } catch (error) {
    console.error("❌ Error Meta API:", error.response?.data || error.message);
  }
}

// --- 4. BARRIDO DINAMODB (Cada 25 segundos) ---
setInterval(async () => {
  try {
    const data = await docClient.send(
      new ScanCommand({
        TableName: process.env.DYNAMO_TABLE_NAME,
        FilterExpression: "#st = :pend",
        ExpressionAttributeNames: { "#st": "Status" },
        ExpressionAttributeValues: { ":pend": "Pendiente" },
      }),
    );

    for (const lead of data.Items || []) {
      console.log(`🚀 Riley iniciando llamada para: ${lead.Phone}`);

      // Marcamos como "En_Llamada" para evitar duplicados en el siguiente ciclo
      await actualizarEstadoDB(lead.Phone, "En_Llamada");

      // Disparo a Vapi
      await axios
        .post(
          "https://api.vapi.ai/call/phone",
          {
            assistantId: process.env.ASSISTANT_ID,
            customer: { number: lead.Phone },
            phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
            },
          },
        )
        .catch((e) => console.error("Error Vapi:", e.message));
    }
  } catch (err) {
    console.error("⚠️ Error en barrido DynamoDB:", err.message);
  }
}, 25000);

// --- FUNCIÓN AUXILIAR DB ---
async function actualizarEstadoDB(phone, nuevoEstado) {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.DYNAMO_TABLE_NAME,
        Key: { Phone: phone },
        UpdateExpression: "SET #st = :val",
        ExpressionAttributeNames: { "#st": "Status" },
        ExpressionAttributeValues: { ":val": nuevoEstado },
      }),
    );
  } catch (e) {
    console.error(
      `❌ Error actualizando ${phone} a ${nuevoEstado}:`,
      e.message,
    );
  }
}

// --- INICIO ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🔥 Riley operativo en el puerto ${PORT}`);
});
