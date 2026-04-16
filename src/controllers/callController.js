const { GetCommand, ScanCommand: ScanCalls } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS;

exports.makeSmartCall = async (req, res) => {
  let { company, email, tenantId } = req.body;

  company = (company || "").trim();
  email = (email || "").toLowerCase().trim();
  tenantId = (tenantId || "").trim();

  try {
    if (!tenantId) {
      return res.status(400).json({ message: "El tenantId es requerido." });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    if (!config) {
      return res
        .status(404)
        .json({ message: "No hay IA configurada para este negocio." });
    }

    const availableMinutes = config.availableMinutes || 0;
    if (availableMinutes <= 0) {
      return res.status(403).json({
        success: false,
        message:
          "No tienes minutos disponibles para realizar llamadas. Por favor, recarga tu saldo.",
        minutes: availableMinutes,
      });
    }

    const { Items: customers } = await dynamoDB.send(
      new ScanCalls({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    const customersToCall = customers || [];

    if (customersToCall.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes activos para llamar." });
    }

    const now = new Date();
    const colombiaHour = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Bogota" }),
    ).getHours();

    let tempGreeting = "Buenos días";
    if (colombiaHour >= 12 && colombiaHour < 18) tempGreeting = "Buenas tardes";
    else if (colombiaHour >= 18 || colombiaHour < 5)
      tempGreeting = "Buenas noches";

    const calls = customersToCall.map(async (customer) => {
      try {
        let rawPhone = customer.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        const customInstructions =
          config.systemPrompt || `Eres un asesor experto de "${company}".`;

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: formattedPhone, name: customer.fullName },
            assistantId: config.assistantId,
            serverUrl:
              "https://fn5q3yfyrc.us-east-1.awsapprunner.com/api/vapi/webhook",
            analysisSchema: {
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
            assistantOverrides: {
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `${customInstructions}

                    DYNAMIC CONTEXT:
                    - Customer: ${customer.fullName}. 
                    - Customer ID: ${customer.id || customer.phone}.
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
              tenantId,
              company,
              clientId: customer.clientId,
              email: email || "sin-email",
            },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );
        return response.data;
      } catch (err) {
        return { error: true, customer: customer.fullName };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
