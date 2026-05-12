const {
  GetCommand,
  ScanCommand: ScanCalls,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

const MASTER_ASSISTANT_ID = "4c266662-68db-4046-a13f-8c021c84919c";

exports.makeSmartCall = async (req, res) => {
  let { company, email, tenantId } = req.body;
  company = (company || "").trim();
  email = (email || "").toLowerCase().trim();
  tenantId = (tenantId || "").trim();

  console.log("--------------------------------------------------");
  console.log("🚀 [INICIO] Petición recibida para makeSmartCall");
  console.log(
    `📡 Datos: Company: ${company}, Email: ${email}, TenantId: ${tenantId}`,
  );

  try {
    if (!tenantId) {
      console.error("❌ [ERROR] tenantId es requerido en el body");
      return res.status(400).json({ message: "tenantId requerido" });
    }

    console.log("🔍 [1/5] Verificando minutos del usuario...");
    const { Item: userDoc } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_USERS,
        Key: { tenantId: tenantId, email: email },
      }),
    );

    console.log(
      `📊 Minutos disponibles encontrados: ${userDoc?.availableMinutes ?? "N/A"}`,
    );
    if ((userDoc?.availableMinutes || 0) <= 0) {
      console.error("🚫 [BLOQUEO] Usuario sin minutos disponibles.");
      return res
        .status(403)
        .json({ success: false, message: "Sin minutos disponibles" });
    }

    console.log(
      "🔍 [2/5] Buscando configuración del agente (TABLE_CONFIGS)...",
    );
    const { Items: configs } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId },
      }),
    );

    let config = configs?.[0];
    console.log(`⚙️ Configuración obtenida: ${config ? "EXITOSA" : "VACÍA"}`);

    if (!config?.assistantId && config?.openaiAssistantId) {
      console.log(
        "🤖 [AUTO-SETUP] AssistantId no existe en Vapi. Intentando crear...",
      );
      try {
        const vapiRes = await axios.post(
          "https://api.vapi.ai/assistant",
          {
            name: `Riley - ${company}`,
            model: {
              provider: "openai",
              model: "gpt-4o",
              tools: [],
              messages: [
                {
                  role: "system",
                  content: `Vinculado a OpenAI Assistant: ${config.openaiAssistantId}.`,
                },
              ],
            },
            voice: { provider: "11labs", voiceId: "paula" },
            firstMessage: `Hola, soy Riley de ${company}. ¿Cómo puedo ayudarte?`,
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        const newVapiId = vapiRes.data.id;
        console.log(`✅ [VAPI] Nuevo asistente creado con ID: ${newVapiId}`);

        await dynamoDB.send(
          new UpdateCommand({
            TableName: TABLE_CONFIGS,
            Key: { tenantId: config.tenantId, agentId: config.agentId },
            UpdateExpression: "SET assistantId = :v",
            ExpressionAttributeValues: { ":v": newVapiId },
          }),
        );
        config.assistantId = newVapiId;
      } catch (vapiErr) {
        console.error(
          "❌ [VAPI ERROR] Falló creación automática:",
          vapiErr.response?.data || vapiErr.message,
        );
      }
    }

    if (!config?.assistantId) {
      console.error(
        "❌ [ERROR CRÍTICO] No se encontró assistantId para llamar.",
      );
      return res
        .status(404)
        .json({ message: "Configuración de Vapi no encontrada." });
    }

    console.log("🔍 [3/5] Buscando clientes con 'call_active: true'...");
    const { Items: customers } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    console.log(`👥 Clientes a procesar: ${customers?.length || 0}`);
    if (!customers || customers.length === 0) {
      console.warn("⚠️ [ADVERTENCIA] No hay clientes con call_active=true.");
      return res.status(404).json({ message: "No hay clientes activos." });
    }

    const colombiaDate = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }),
    );
    const fechaHoy = colombiaDate.toISOString().split("T")[0];

    console.log("📲 [4/5] Iniciando bucle de llamadas...");
    const callPromises = customers.map(async (customer) => {
      try {
        const rawPhone = (customer.phone || "").toString().replace(/\s+/g, "");
        const formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        console.log(
          `📞 Intentando llamar a ${customer.fullName} al número ${formattedPhone}`,
        );

        const vapiPayload = {
          customer: { number: formattedPhone, name: customer.fullName },
          assistantId: MASTER_ASSISTANT_ID,
          phoneNumberId:
            config.vapiPhoneNumberId || "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          assistantOverrides: {
            serverUrl:
              "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/vapi/webhook",
            silenceTimeoutSeconds: 45,
            maxDurationSeconds: 600,
            backchannelingEnabled: true,
            model: {
              provider: "openai",
              model: "gpt-4o",
              // NOTA: No incluimos assistantId de OpenAI aquí porque genera conflicto 400 en overrides.
              // Usamos el conocimiento vía el prompt y las herramientas definidas.
              tools: [
                {
                  type: "function",
                  messages: [
                    {
                      type: "request-start",
                      content: "Agendando tu cita, un momento...",
                    },
                  ],
                  function: {
                    name: "create_task",
                    description: "Registra una cita o tarea con fecha y hora.",
                    parameters: {
                      type: "object",
                      properties: {
                        titulo: { type: "string" },
                        detalle: { type: "string" },
                        tenantId: { type: "string" },
                        clientId: { type: "string" },
                        customerName: { type: "string" },
                        company: { type: "string" },
                        cita: { type: "string" },
                      },
                      required: [
                        "titulo",
                        "detalle",
                        "tenantId",
                        "clientId",
                        "customerName",
                        "company",
                        "cita",
                      ],
                    },
                  },
                  server: {
                    url: "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/vapi/riley-create",
                  },
                },
              ],
              messages: [
                {
                  role: "system",
                  content: `Eres Riley, experta vendedora de autos profesional de la empresa ${company}. Hoy es ${fechaHoy}.

                  ACCESO A DOCUMENTOS (CRÍTICO):
                  - Tienes archivos cargados con inventario y fichas técnicas en tu asistente base.
                  - Si el cliente pregunta por detalles técnicos, busca en tu conocimiento.
                  - IMPORTANTE: Mientras buscas, DEBES DECIR: "Un momento por favor, estoy verificando los detalles técnicos en mi sistema..." para evitar silencios.
                  - NUNCA inventes datos. Si el sistema tarda, di: "Sigo aquí, verificando la ficha técnica...".

                  REGLAS DE ORO:
                  1. EMPATÍA Y SONDEO: Saluda y sondea necesidades.
                  2. PRECIOS: Siempre en palabras.
                  3. NO COLGAR: Mantén al cliente informado.

                  AGENDAMIENTO DE CITAS:
                  - Usa obligatoriamente 'create_task' si se acuerda la cita.
                  - DATOS: tenantId: "${tenantId}", clientId: "${customer.clientId}", customerName: "${customer.fullName}", company: "${company}".`,
                },
              ],
            },
            analysisPlan: {
              structuredDataSchema: {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    enum: [
                      "No_contesto",
                      "Contacto",
                      "Información",
                      "Interés",
                      "Cita",
                      "Negociación",
                      "Cierre",
                      "Pérdida",
                    ],
                  },
                  progress: { type: "number" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["Baja", "Media", "Alta"] },
                  cita: { type: "string" },
                },
                required: [
                  "status",
                  "progress",
                  "description",
                  "priority",
                  "cita",
                ],
              },
            },
          },
        };

        console.log("📤 [VAPI] Enviando Payload...");
        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          vapiPayload,
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        console.log(
          `✅ [VAPI SUCCESS] Llamada iniciada para ${customer.fullName}. CallId: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ [ERROR LLAMADA] Falló para ${customer.fullName}:`,
          err.response?.data || err.message,
        );
        return {
          error: true,
          customer: customer.fullName,
          detail: err.response?.data,
        };
      }
    });

    console.log("⏳ [5/5] Esperando a que todas las peticiones terminen...");
    const results = await Promise.all(callPromises);
    console.log("🏁 [FIN] Todas las peticiones de llamada han sido enviadas.");
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 [FATAL ERROR] Error general en el servidor:", e.message);
    res.status(500).json({ error: e.message });
  }
};
