const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.makeSmartCall = async (req, res) => {
  let { company, email, tenantId } = req.body;

  company = (company || "").trim();
  email = (email || "").toLowerCase().trim();
  tenantId = (tenantId || "").trim();

  try {
    if (!tenantId) {
      return res.status(400).json({ message: "El tenantId es requerido." });
    }

    // 1. Obtener la configuración de la IA desde DynamoDB
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

    // 2. VALIDACIÓN DE MINUTOS: Si es 0 o menos, bloqueamos la llamada
    const availableMinutes = config.availableMinutes || 0;
    if (availableMinutes <= 0) {
      return res.status(403).json({
        success: false,
        message:
          "No tienes minutos disponibles para realizar llamadas. Por favor, recarga tu saldo.",
        minutes: availableMinutes,
      });
    }

    // 3. Obtener clientes activos para este tenant
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

    // 4. Lógica de saludo dinámico por hora
    const ahora = new Date();
    const horaColombia = new Date(
      ahora.toLocaleString("en-US", { timeZone: "America/Bogota" }),
    ).getHours();

    let saludoTemporal = "Buenos días";
    if (horaColombia >= 12 && horaColombia < 18)
      saludoTemporal = "Buenas tardes";
    else if (horaColombia >= 18 || horaColombia < 5)
      saludoTemporal = "Buenas noches";

    // 5. PROCESO DE LLAMADAS
    const calls = clientesParaLlamar.map(async (cliente) => {
      try {
        let rawPhone = cliente.phone.toString().replace(/\s+/g, "");
        let formattedPhone = rawPhone.startsWith("+")
          ? rawPhone
          : `+57${rawPhone}`;

        // IA DINÁMICA: Usamos el prompt guardado por el cliente o uno por defecto
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
                    - Estás hablando con: ${cliente.fullName}. 
                    - Inicia diciendo: "${saludoTemporal} ${cliente.fullName}".
                    - Empresa: ${company}.

                    REGLAS DE OPERACIÓN:
                    1. Si pide cita, usa el PROTOCOLO DE CITA.
                    2. No inventes datos, si no sabes algo, ofrece ayuda general.
                    3. No cuelgues hasta que el cliente se despida.

                    PROTOCOLO DE CITA:
                    - Paso 1: Pregunta fecha y hora.
                    - Paso 2: Usa 'create_task' para registrarla.

                    DATOS PARA TAREA:
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
        console.error(`Error llamando a ${cliente.fullName}:`, err.message);
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("Error general en makeSmartCall:", e);
    res.status(500).json({ error: e.message });
  }
};
