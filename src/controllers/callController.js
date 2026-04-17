const { GetCommand, ScanCommand: ScanCalls } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

exports.makeSmartCall = async (req, res) => {
  let { company, email, tenantId } = req.body;
  console.log(">>> Iniciando makeSmartCall para tenantId:", tenantId);

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

    if (!config) {
      return res.status(404).json({ message: "No hay IA configurada." });
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
            customer: { number: formattedPhone, name: customer.fullName },
            assistantId: config.assistantId,
            assistantOverrides: {
              serverUrl:
                "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/vapi/webhook",
              analysisPlan: {
                structuredDataSchema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: [
                        "NO_ANSWER",
                        "INTERESTED",
                        "INFO_SENT",
                        "APPOINTMENT_SET",
                        "DOCUMENTATION",
                        "RESERVATION",
                        "CREDIT_PENDING",
                        "CLOSED_DEAL",
                      ],
                    },
                    progress: { type: "number" },
                  },
                },
              },
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `${config.systemPrompt || `Eres un asesor experto de "${company}".`}

                    DYNAMIC CONTEXT:
                    - Customer: ${customer.fullName}. 
                    - Customer ID: ${customer.clientId}.
                    - Starts with: "${tempGreeting} ${customer.fullName}".
                    - Company: ${company}.

                    PROGRESS STATUS RULES:
                    - NO_ANSWER: 0
                    - INTERESTED: 10
                    - INFO_SENT: 30
                    - APPOINTMENT_SET: 50
                    - DOCUMENTATION: 70
                    - RESERVATION: 80
                    - CREDIT_PENDING: 90
                    - CLOSED_DEAL: 100

                    If they want to schedule, use 'create_task'.`,
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
                        },
                        required: [
                          "titulo",
                          "detalle",
                          "tenantId",
                          "clientId",
                          "customerName",
                        ],
                      },
                    },
                    server: {
                      url: "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/task/riley-create",
                    },
                  },
                ],
              },
            },
            phoneNumberId:
              config.vapiPhoneNumberId ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
            metadata: {
              tenantId: tenantId,
              company: company,
              clientId: customer.clientId,
              email: email || "sin-email",
            },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        return response.data;
      } catch (err) {
        console.error(
          `ERR: Falló la llamada para ${customer.fullName}:`,
          err.response?.data || err.message,
        );
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
