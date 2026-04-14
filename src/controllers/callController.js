const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.updatePrompt = async (req, res) => {
  const { tenantId, systemPrompt } = req.body;

  if (!tenantId || systemPrompt === undefined) {
    return res
      .status(400)
      .json({ message: "tenantId y systemPrompt son requeridos." });
  }

  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId }, // Verifica que la PK en AWS sea businessId
        UpdateExpression: "set systemPrompt = :p",
        ExpressionAttributeValues: { ":p": systemPrompt },
      }),
    );

    res
      .status(200)
      .json({
        success: true,
        message: "Instrucciones actualizadas correctamente.",
      });
  } catch (e) {
    console.error("Error en updatePrompt:", e);
    res.status(500).json({ error: e.message });
  }
};

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

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: { ":t": tenantId, ":a": true },
      }),
    );

    const clientesParaLlamar = clientes || [];

    if (clientesParaLlamar.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes activos para llamar." });
    }

    const ahora = new Date();
    const horaColombia = new Date(
      ahora.toLocaleString("en-US", { timeZone: "America/Bogota" }),
    ).getHours();

    let saludoTemporal = "Buenos días";
    if (horaColombia >= 12 && horaColombia < 18)
      saludoTemporal = "Buenas tardes";
    else if (horaColombia >= 18 || horaColombia < 5)
      saludoTemporal = "Buenas noches";

    const calls = clientesParaLlamar.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        const customInstructions =
          config.systemPrompt || `Eres un asesor experto de "${company}".`;

        const response = await axios.post(
          "https://api.vapi.ai/call/phone",
          {
            customer: { number: formattedPhone, name: cliente.fullName },
            assistantId: config.assistantId,
            assistantOverrides: {
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `${customInstructions}

                    CONTEXTO DINÁMICO:
                    - Cliente: ${cliente.fullName}. 
                    - Inicia con: "${saludoTemporal} ${cliente.fullName}".
                    - Empresa: ${company}.

                    REGLAS:
                    1. Usa PROTOCOLO DE CITA si piden agendar.
                    2. No inventes datos.
                    3. No cuelgues hasta que se despidan.

                    PROTOCOLO DE CITA:
                    - Pide fecha y hora, luego usa 'create_task'.

                    DATOS TAREA:
                    - titulo: Cita - ${cliente.fullName}
                    - tenantId: ${tenantId}`,
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
                        },
                        required: ["titulo", "detalle", "tenantId"],
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
            metadata: { tenantId, company, email: email || "sin-email" },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );
        return response.data;
      } catch (err) {
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
