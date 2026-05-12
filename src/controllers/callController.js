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
    `📡 Datos entrada: Company: ${company}, Email: ${email}, TenantId: ${tenantId}`,
  );

  try {
    if (!tenantId) {
      console.error("❌ [ERROR] tenantId es requerido");
      return res.status(400).json({ message: "tenantId requerido" });
    }

    console.log("🔍 [1/6] Verificando minutos del usuario en TABLE_USERS...");
    const { Item: userDoc } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_USERS,
        Key: { tenantId: tenantId, email: email },
      }),
    );

    console.log(
      `📊 Minutos encontrados: ${userDoc?.availableMinutes ?? "N/A"}`,
    );
    if ((userDoc?.availableMinutes || 0) <= 0) {
      console.error("🚫 [BLOQUEO] Usuario sin minutos disponibles.");
      return res
        .status(403)
        .json({ success: false, message: "Sin minutos disponibles" });
    }

    console.log("🔍 [2/6] Buscando configuración en TABLE_CONFIGS...");
    const { Items: configs } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId },
      }),
    );

    let config = configs?.[0];
    console.log(
      `⚙️ Configuración obtenida: ${config ? "EXISTE" : "NO EXISTE"}`,
    );

    if (!config?.assistantId && config?.openaiAssistantId) {
      console.log(
        "🤖 [AUTO-SETUP] assistantId no existe. Intentando crear asistente en Vapi...",
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
              knowledgeBase: {
                provider: "openai",
                assistantId: config.openaiAssistantId,
              },
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
        console.log("📝 [DYNAMO] assistantId actualizado en la base de datos.");
      } catch (vapiErr) {
        console.error(
          "❌ [ERROR VAPI SETUP]:",
          vapiErr.response?.data || vapiErr.message,
        );
      }
    }

    if (!config?.assistantId) {
      console.error(
        "❌ [ERROR] No hay assistantId disponible para realizar llamadas.",
      );
      return res
        .status(404)
        .json({ message: "Configuración de Vapi no encontrada." });
    }

    console.log(
      "🔍 [3/6] Buscando clientes con call_active=true en TABLE_CLIENTS...",
    );
    const { Items: customers } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    console.log(`👥 Clientes activos encontrados: ${customers?.length || 0}`);
    if (!customers || customers.length === 0) {
      console.warn("⚠️ [AVISO] No hay clientes para llamar.");
      return res.status(404).json({ message: "No hay clientes activos." });
    }

    const now = new Date();
    const colombiaDate = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Bogota" }),
    );
    const hour = colombiaDate.getHours();
    const fechaHoy = colombiaDate.toISOString().split("T")[0];

    let tempGreeting =
      hour >= 12 && hour < 18
        ? "Buenas tardes"
        : hour >= 18 || hour < 5
          ? "Buenas noches"
          : "Buenos días";

    console.log("📲 [4/6] Iniciando promesas de llamadas...");
    const callPromises = customers.map(async (customer) => {
      try {
        const rawPhone = (customer.phone || "").toString().replace(/\s+/g, "");
        const formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        console.log(
          `📞 Llamando a: ${customer.fullName} (${formattedPhone})...`,
        );

        const vapiPayload = {
          customer: { number: formattedPhone, name: customer.fullName },
          // SOLUCIÓN: Usamos el ID del asistente de VAPI creado para este tenant.
          // Este asistente YA TIENE vinculado el knowledgeBase de OpenAI.
          assistantId: config.assistantId || MASTER_ASSISTANT_ID,
          metadata: {
            tenantId: tenantId,
            clientId: customer.clientId,
            company: company,
            email: email,
          },
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
              // CORRECCIÓN: Se eliminaron 'assistantId' y 'knowledgeBase' de aquí.
              // Vapi no permite sobrescribirlos en los overrides de una llamada.
              // Riley heredará automáticamente el conocimiento del asistente definido en la línea 159.
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
                  content: `Eres Riley, la asistente virtual de la empresa ${company}. Tu tono es amable, profesional y muy humano. Olvida tecnicismos robóticos. Hoy es ${fechaHoy}.

                  PERSONALIDAD Y SALUDO:
                  - Saluda de forma natural: "${tempGreeting} ${customer.fullName}, ¿cómo se encuentra hoy?".
                  - Preséntate como: "Soy Riley, su asistente virtual de ${company}".

                  MANEJO DE CONOCIMIENTO (PDF):
                  - Tienes acceso a archivos cargados mediante búsqueda semántica. Úsalos para dar detalles de autos, inventario y fichas técnicas.
                  - Mientras buscas en los archivos, di frases naturales como: "Claro, permítame un segundito miro qué tengo disponible para usted..." o "Déjeme revisar rápidamente qué modelos nos quedan...".
                  - Si tras buscar en los archivos NO encuentras la información, di amablemente: "Por el momento no cuento con ese dato exacto aquí, pero puedo pedirle a un asesor que le envíe la ficha técnica por WhatsApp".

                  REGLAS ADICIONALES:
                  1. PRECIOS: Siempre díselos en palabras (ej: "Veinte millones de pesos").
                  2. EMPATÍA: Escucha las necesidades del cliente antes de ofrecer modelos.
                  3. CIERRE: Antes de agendar la cita, consulta cuál sería su método de pago preferido (Efectivo, crédito, etc).

                  AGENDAMIENTO:
                  - Usa 'create_task' para registrar citas. Determina tú misma el título y el detalle según la conversación.
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

        console.log(
          `📤 [VAPI] Enviando petición de llamada para ${customer.fullName}...`,
        );
        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          vapiPayload,
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        console.log(
          `✅ [EXITO] Llamada iniciada para ${customer.fullName}. ID: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ [ERROR EN LLAMADA] Falló para ${customer.fullName}:`,
          err.response?.data || err.message,
        );
        return {
          error: true,
          customer: customer.fullName,
          detail: err.response?.data,
        };
      }
    });

    console.log("⏳ [5/6] Esperando resolución de todas las llamadas...");
    const results = await Promise.all(callPromises);

    console.log("🏁 [6/6] Proceso finalizado.");
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 [FATAL ERROR] Error general en el servidor:", e.message);
    res.status(500).json({ error: e.message });
  }
};
