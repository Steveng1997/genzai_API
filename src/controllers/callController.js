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

exports.makeSmartCall = async (req, res) => {
  let { company, email, tenantId } = req.body;
  company = (company || "").trim();
  email = (email || "").toLowerCase().trim();
  tenantId = (tenantId || "").trim();

  console.log(`🚀 Iniciando makeSmartCall para tenantId: ${tenantId}`);

  try {
    if (!tenantId)
      return res.status(400).json({ message: "tenantId requerido" });

    // 1. Verificar disponibilidad de minutos
    const { Item: userDoc } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_USERS,
        Key: { tenantId: tenantId, email: email },
      }),
    );

    if ((userDoc?.availableMinutes || 0) <= 0) {
      return res
        .status(403)
        .json({ success: false, message: "Sin minutos disponibles" });
    }

    // 2. Obtener configuración del agente
    const { Items: configs } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId },
      }),
    );

    let config = configs?.[0];

    // 🤖 CREACIÓN AUTOMÁTICA DE ASISTENTE EN VAPI (SI NO EXISTE)
    if (!config?.assistantId && config?.openaiAssistantId) {
      console.log("🤖 Configurando nuevo asistente en Vapi...");
      try {
        const vapiRes = await axios.post(
          "https://api.vapi.ai/assistant",
          {
            name: `Riley - ${company}`,
            model: {
              provider: "openai",
              model: "gpt-4o",
              messages: [
                {
                  role: "system",
                  content: `Vinculado a OpenAI Assistant: ${config.openaiAssistantId}.`,
                },
              ],
            },
            voice: {
              provider: "11labs",
              voiceId: "paula",
            },
            firstMessage: `Hola, soy Riley de ${company}. ¿Cómo puedo ayudarte?`,
          },
          {
            headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
          },
        );

        const newVapiId = vapiRes.data.id;
        await dynamoDB.send(
          new UpdateCommand({
            TableName: TABLE_CONFIGS,
            Key: { tenantId: config.tenantId, agentId: config.agentId },
            UpdateExpression: "SET assistantId = :v",
            ExpressionAttributeValues: { ":v": newVapiId },
          }),
        );
        config.assistantId = newVapiId;
        console.log(`✅ Asistente Vapi vinculado: ${newVapiId}`);
      } catch (vapiErr) {
        console.error(
          "❌ Error en creación de asistente:",
          vapiErr.response?.data || vapiErr.message,
        );
      }
    }

    if (!config?.assistantId) {
      return res
        .status(404)
        .json({ message: "Configuración de Vapi no encontrada." });
    }

    // 3. Obtener clientes con llamadas activas
    const { Items: customers } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    if (!customers || customers.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes activos para procesar." });
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

    // 4. Disparar llamadas en paralelo
    const callPromises = customers.map(async (customer) => {
      try {
        const rawPhone = customer.phone.toString().replace(/\s+/g, "");
        const formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        const vapiPayload = {
          customer: { number: formattedPhone, name: customer.fullName },
          assistantId: config.assistantId,
          phoneNumberId:
            config.vapiPhoneNumberId || "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
          assistantOverrides: {
            serverUrl:
              "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/vapi/webhook",
            silenceTimeoutSeconds: 30,
            maxDurationSeconds: 600,
            backchannelingEnabled: true,
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
                    description:
                      "El estado actual de la venta basado en la interacción.",
                  },
                  progress: {
                    type: "number",
                    description: "Avance 0-100 según el estado definido.",
                  },
                  description: {
                    type: "string",
                    description: "Resumen detallado de la conversación.",
                  },
                  priority: {
                    type: "string",
                    enum: ["Baja", "Media", "Alta"],
                  },
                  cita: {
                    type: "string",
                    description: "Fecha/hora acordada o 'No definida'.",
                  },
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
            model: {
              provider: "openai",
              model: "gpt-4o",
              messages: [
                {
                  role: "system",
                  content: `Eres Riley, una experta vendedora de autos profesional de la empresa ${company}. 

                  CONTEXTO TEMPORAL: Hoy es ${fechaHoy}.

                  ACCESO A DOCUMENTOS Y CONOCIMIENTO (CRÍTICO):
                  - Tienes acceso directo a FICHAS TÉCNICAS y documentos PDF.
                  - Si el cliente pregunta por detalles técnicos (medidas, torque, HP, airbags, frenos ABS), DEBES usar 'file_search' para dar el dato exacto.
                  - NUNCA inventes datos. Si el PDF dice que mide 4,740mm o tiene 7 airbags, dile exactamente eso.
                  - Si el sistema tarda, di: "Sigo aquí, estoy verificando el dato exacto en la ficha técnica...".

                  RACIOCINIO DE PRODUCTOS E INVENTARIO:
                  - Entiende variaciones fonéticas: "Toyotas" es Toyota, "Spark uiti" es Chevrolet Spark. Asocia errores al modelo más lógico.

                  ESTADOS Y PROGRESO:
                  0. No_contesto (0%): No contestó la llamada o cayó a buzón.
                    1. Contacto (10%): Contestó y hubo saludo inicial exitoso.
                    2. Información (30%): Se brindó detalle de vehículos o se enviará info.
                    3. Interés (50%): El cliente mostró interés real en modelos específicos.
                    4. Cita (70%): El cliente acepta o solicita una cita para ver el auto personalmente.
                    5. Negociación (85%): Discutiendo formas de pago o créditos.
                    6. Cierre (100%): Venta confirmada.
                    7. Pérdida (0%): El cliente indica que ya no está interesado.
                    
                  PENSAMIENTO ANALÍTICO E INFERENCIA:
                  - Tu objetivo es clasificar el avance real. Si hubo conversación fluida, nunca entregues 1%.
                  - Si el cliente acepta una cita, aunque no se concrete la hora exacta aún, ya estás en 70%.
                  - Si el cliente solo pide información de los PDFs, estás en 30%.
                  - Al finalizar, evalúa: si usaste 'create_task', el estado es CITA y el progreso 70% obligatoriamente.

                  REGLAS DE ORO:
                  1. EMPATÍA Y SONDEO: Saluda y sondea necesidades antes de ofrecer.
                  2. DISCRECIÓN: Prohibido decir "PDF". Di "revisando mis registros".
                  3. PRECIOS: Siempre en palabras (ej: "Cien millones de pesos").
                  4. LÓGICA HORARIA: Operamos de 7:00 a.m. a 6:00 p.m.
                  5. NO COLGAR: Si buscas en documentos, mantén al cliente informado.

                  FLUJO DE CONVERSACIÓN:
                  1. SALUDO: ${tempGreeting} ${customer.fullName}.
                  2. SONDEO Y BÚSQUEDA: Usa los PDFs para dar opciones reales del inventario.
                  3. CIERRE: Pregunta método de pago antes de la cita.

                  AGENDAMIENTO DE CITAS (USO DE 'create_task'):
                  1. Pregunta DÍA y luego HORA. 
                  2. Si el cliente dice "mañana" o "el jueves", calcula la fecha real basándote en que hoy es ${fechaHoy}.
                  3. FORMATO CAMPO 'cita': "[Día], [Hora] [a.m./p.m.]". Ejemplo: "Lunes, 10:00 a.m.".
                  4. Es OBLIGATORIO usar 'create_task' si se acuerda la cita.

                  DATOS OBLIGATORIOS 'create_task':
                  - tenantId: "${tenantId}", clientId: "${customer.clientId}", customerName: "${customer.fullName}", company: "${company}", cita: (Horario calculado y acordado).`,
                },
              ],
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
            },
          },
        };

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          vapiPayload,
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        return response.data;
      } catch (err) {
        console.error(
          `❌ Error en llamada a ${customer.fullName}:`,
          err.response?.data || err.message,
        );
        return { error: true, customer: customer.fullName };
      }
    });

    const results = await Promise.all(callPromises);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 Error crítico:", e.message);
    res.status(500).json({ error: e.message });
  }
};
