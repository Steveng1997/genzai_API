const { GetCommand, ScanCommand: ScanCalls } = require("@aws-sdk/lib-dynamodb");
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

  try {
    if (!tenantId) {
      return res.status(400).json({ message: "El tenantId es requerido." });
    }

    const { Item: userDoc } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_USERS,
        Key: { email: email },
      }),
    );

    const availableMinutes = userDoc?.availableMinutes || 0;
    if (availableMinutes <= 0) {
      return res.status(403).json({
        success: false,
        message: "No tienes minutos disponibles.",
        minutes: availableMinutes,
      });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    if (!config || !config.assistantId) {
      return res.status(404).json({
        message: "No hay IA configurada en Vapi o falta assistantId.",
      });
    }

    const { Items: customers } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    if (!customers || customers.length === 0) {
      return res.status(404).json({ message: "No hay clientes activos." });
    }

    const now = new Date();
    const colombiaHour = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Bogota" }),
    ).getHours();

    let tempGreeting = "Buenos días";
    if (colombiaHour >= 12 && colombiaHour < 18) tempGreeting = "Buenas tardes";
    else if (colombiaHour >= 18 || colombiaHour < 5)
      tempGreeting = "Buenas noches";

    const calls = customers.map(async (customer) => {
      try {
        let rawPhone = customer.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: {
              number: formattedPhone,
              name: customer.fullName,
            },
            assistantId: config.assistantId,
            phoneNumberId:
              config.vapiPhoneNumberId ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
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
                      description:
                        "Un número del 0 al 100 que represente el avance según la tabla de estados definida.",
                    },
                    description: {
                      type: "string",
                      description:
                        "Un resumen detallado de la conversación, acuerdos y necesidades del cliente.",
                    },
                    priority: {
                      type: "string",
                      enum: ["Baja", "Media", "Alta"],
                    },
                  },
                  required: ["status", "progress", "description", "priority"],
                },
              },
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `Eres Riley, una experta vendedora de autos profesional de la empresa ${company}. Tu prioridad es escuchar al cliente y asesorarlo según el inventario disponible.
                    
                    ESTADOS Y PROGRESO (ESCALA OBLIGATORIA):
                    0. No_contesto (0%): No contestó la llamada o cayó a buzón.
                    1. Contacto (10%): Contestó y hubo saludo inicial exitoso.
                    2. Información (30%): Se brindó detalle de vehículos o se enviará info.
                    3. Interés (50%): El cliente mostró interés real en modelos específicos.
                    4. Cita (70%): El cliente acepta o solicita una cita para ver el auto personalmente.
                    5. Negociación (85%): Discutiendo formas de pago o créditos.
                    6. Cierre (100%): Venta confirmada.
                    7. Pérdida (0%): El cliente indica que ya no está interesado.
                    
                    REGLAS DE ORO (PROHIBIDO FALLAR):
                    1. EMPATÍA Y SONDEO: No lances ofertas de inmediato. Saluda y pregunta necesidades.
                    2. BÚSQUEDA DE INVENTARIO: Di "Permítame un segundo reviso...". PROHIBIDO decir "PDF" o "archivo".
                    3. NO COLGAR: Si el sistema tarda, di "Sigo aquí buscando los detalles".
                    4. PRECIOS: Di los precios en palabras (ej: "Diez millones de pesos").
                    5. ACTUALIZACIÓN DE ESTADO (CRÍTICO): Si el cliente pide agendar una cita o muestra disposición para ver el auto, tu estado DEBE ser CITA (70%) obligatoriamente.
                    6. LÓGICA HORARIA: La empresa opera de 7:00 a.m. a 6:00 p.m.
    
                    PENSAMIENTO ANALÍTICO E INFERENCIA:
                    - Tu objetivo es clasificar el avance real. Si hubo conversación fluida, nunca entregues 1%.
                    - Si el cliente acepta una cita, aunque no se concrete la hora exacta aún, ya estás en 70%.
                    - Si el cliente solo pide catálogos o información general, estás en 30%.
                    - Al finalizar, evalúa: si usaste 'create_task', el estado es CITA y el progreso 70%.
    
                    FLUJO DE CONVERSACIÓN:
                    1. SALUDO: ${tempGreeting} ${customer.fullName}.
                    2. SONDEO: Entiende qué busca el cliente antes de ofrecer modelos.
                    3. INVENTARIO: Da opciones reales del inventario adjunto.
                    4. CIERRE: Pregunta método de pago (Efectivo o Transferencia) antes de la cita.
    
                    AGENDAMIENTO DE CITAS:
                    1. Pregunta DÍA y luego HORA.
                    2. FORMATO CAMPO 'cita': "[Día], [Hora] [a.m./p.m.]". Ejemplo: "Martes, 3:00 p.m.".
                    3. CONFIRMA con el cliente y luego usa la herramienta 'create_task'.
    
                    INSTRUCCIÓN DE CIERRE DE DATOS:
                    Es vital que analices la conversación. El resumen en 'description' debe ser muy detallado (ej: "Interesado en SUV Mazda CX-5, se agendó cita para el miércoles"). No cierres sin actualizar el progreso al nivel más alto alcanzado.
    
                    DATOS OBLIGATORIOS 'create_task':
                    - tenantId: "${tenantId}"
                    - clientId: "${customer.clientId}"
                    - customerName: "${customer.fullName}"
                    - company: "${company}"
                    - cita: (El horario acordado en el formato especificado)`,
                  },
                ],
                tools: [
                  {
                    type: "function",
                    messages: [
                      {
                        type: "request-start",
                        content: "Un momento, estoy agendando tu cita...",
                      },
                    ],
                    function: {
                      name: "create_task",
                      description:
                        "Registra una cita o tarea con fecha y hora en el sistema.",
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
            metadata: {
              tenantId: tenantId,
              company: company,
              clientId: customer.clientId,
              email: email,
            },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        return response.data;
      } catch (err) {
        return {
          error: true,
          customer: customer.fullName,
          details: err.response?.data,
        };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
