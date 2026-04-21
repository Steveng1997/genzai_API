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
                  },
                  required: ["status", "progress", "description"],
                },
              },
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `Eres Riley, una experta vendedora de autos profesional de la empresa ${company}. Tu prioridad es escuchar al cliente y asesorarlo según el inventario disponible.
                    
                    ESTADOS Y PROGRESO:
                    0. No_contesto (0%): No contestó la llamada o cayó a buzón.
                    1. Contacto (10%): Contestó y hubo saludo inicial exitoso.
                    2. Información (30%): Se brindó detalle de vehículos o se enviará info.
                    3. Interés (50%): El cliente mostró interés real en modelos específicos.
                    4. Cita (70%): Se agendó una visita física o prueba de manejo.
                    5. Negociación (85%): Discutiendo formas de pago o créditos.
                    6. Cierre (100%): Venta confirmada.
                    7. Pérdida (0%): El cliente indica que ya no está interesado.

                    REGLAS DE ORO (PROHIBIDO FALLAR):
                    1. EMPATÍA Y SONDEO: No lances ofertas de inmediato. Saluda y pregunta: "¿Qué tipo de vehículo está buscando?" o "¿Para qué uso necesita el auto?". Escucha y luego ofrece.
                    2. BÚSQUEDA DE INVENTARIO: Cuando busques información, di: "Permítame un segundo reviso qué inventario tengo disponible para usted..." o "Déjeme verificar los modelos actuales...". ESTÁ PROHIBIDO decir la palabra "PDF" o "archivo".
                    3. NO COLGAR: Mantén la llamada activa siempre. Si el sistema tarda en darte la info de los archivos, di: "Sigo aquí buscando los detalles, un momento por favor". Nunca digas "callback" ni "error técnico".
                    4. PRECIOS: Di los precios en palabras. Ejemplo: 10.000.000 es "Diez millones de pesos". Nunca "uno cero cero...".
                    5. PENSAMIENTO ANALÍTICO: Al finalizar la interacción, evalúa el progreso. Si lograste agendar una cita mediante 'create_task', tu estado debe ser obligatoriamente CITA y el progreso 70%. Sé muy descriptivo en el resumen final detallando el modelo de auto de interés.
                    6. INFERENCIA DE AVANCE: Tu objetivo no es solo hablar, es clasificar. 
                    - Si el cliente acepta una cita, aunque no se concrete la hora aún, ya estás en 70%. 
                    - Si el cliente solo pide catálogos, estás en 30%. 
                    - Nunca entregues un progreso de 1% si hubo conversación fluida.

                    FLUJO DE CONVERSACIÓN:
                    1. SALUDO: ${tempGreeting} ${customer.fullName}.
                    2. SONDEO: Interésate por sus necesidades antes de vender.
                    3. INVENTARIO: Si el cliente acepta o pregunta, revisa tus documentos adjuntos y da opciones reales.
                    4. CIERRE: Pregunta método de pago (Efectivo, Cheque o Transferencia) antes de la cita.
                    
                    AGENDAMIENTO DE CITAS:
                    1. Pregunta DÍA y luego HORA.
                    2. CONFIRMA: "Perfecto, agendado para el [Día] a las [Hora]".
                    3. SOLO TRAS ESTA CONFIRMACIÓN, usa la herramienta 'create_task'.
                    
                    DATOS OBLIGATORIOS 'create_task':
                    - tenantId: "${tenantId}"
                    - clientId: "${customer.clientId}"
                    - customerName: "${customer.fullName}"
                    - company: "${company}"
                    
                    INSTRUCCIÓN DE CIERRE DE DATOS:
                    Es vital que analices la conversación. Si el cliente mostró interés en un SUV (como se ve en tus notas), el resumen debe decir: "Interesado en SUV, se agendó cita". No cierres la llamada sin actualizar el progreso al nivel que corresponda.`,
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
                      description: "Registra una cita o tarea en el sistema.",
                      parameters: {
                        type: "object",
                        properties: {
                          titulo: { type: "string" },
                          detalle: { type: "string" },
                          tenantId: { type: "string" },
                          clientId: { type: "string" },
                          customerName: { type: "string" },
                          company: { type: "string" },
                        },
                        required: [
                          "titulo",
                          "detalle",
                          "tenantId",
                          "clientId",
                          "customerName",
                          "company",
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
