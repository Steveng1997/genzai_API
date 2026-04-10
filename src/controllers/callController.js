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

  console.log(
    `\n[${new Date().toISOString()}] --- INICIO PROCESO DE LLAMADA: ${company} (ID: ${tenantId}) ---`,
  );

  try {
    if (!tenantId) {
      console.error("❌ Error: tenantId no proporcionado");
      return res.status(400).json({
        message: "El identificador de instancia (tenantId) es requerido.",
      });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: tenantId },
      }),
    );

    if (!config) {
      console.error(
        `❌ Error: No se encontró configuración de IA para el ID: ${tenantId}`,
      );
      return res
        .status(404)
        .json({ message: "No hay IA configurada para esta empresa" });
    }

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "tenantId = :t AND call_active = :a",
        ExpressionAttributeValues: {
          ":t": tenantId,
          ":a": true,
        },
      }),
    );

    const clientesParaLlamar = clientes || [];

    console.log(
      `📊 Leads encontrados para este tenant: ${clientesParaLlamar.length}`,
    );

    if (clientesParaLlamar.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay clientes activos para llamar" });
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

        console.log(`📞 Marcando -> ${cliente.fullName} (${formattedPhone})`);

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
                    content: `Eres Riley, asesor experto de "${company}". Estás hablando con ${cliente.fullName}.
                    
                    SALUDO: "${saludoTemporal} ${cliente.fullName}, ¿cómo te encuentras el día de hoy?".
                    
                    OBJETIVO Y REGLAS DE ORO:
                    1. PRIORIDAD DE INFORMACIÓN: Tu fuente principal es el PDF y los archivos subidos. Si el cliente pregunta por un vehículo o producto, búscalo primero ahí.
                    
                    2. MANEJO DE INVENTARIO: 
                    - Si el producto ESTÁ en el PDF: Da las especificaciones y trata de cerrar el interés.
                    - Si el producto NO está: No digas simplemente "no lo tengo". Busca en tus archivos ALTERNATIVAS similares que sí estén disponibles y ofrécelas.
                    
                    3. PROTOCOLO DE CITA (Solo como último recurso o cierre):
                    - Solo ofrece agendar una cita si el cliente no encontró lo que buscaba o si ya está listo para ver un producto físicamente.
                    - REGLA CRÍTICA: ANTES de usar la herramienta 'create_task', debes preguntar: "¿Qué día y hora le queda bien para la cita?". 
                    - NO puedes agendar sin que el cliente te confirme primero la disponibilidad.

                    DATOS PARA LA HERRAMIENTA 'create_task' (Solo tras tener fecha y hora):
                    - titulo: Cita Vehículo - ${cliente.fullName}
                    - detalle: Cita acordada para [insertar fecha/hora confirmada por cliente] sobre el interés en ${company}.
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
                      description:
                        "Registra una cita o tarea en el sistema de gestión.",
                      parameters: {
                        type: "object",
                        properties: {
                          titulo: { type: "string" },
                          detalle: { type: "string" },
                          company: { type: "string" },
                          tenantId: { type: "string" },
                        },
                        required: ["titulo", "detalle", "tenantId"],
                      },
                    },
                    server: {
                      url: "https://TU-URL-DE-BACKEND.com/api/task/riley-create",
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
              email: email || "sin-email",
            },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        console.log(
          `✅ Llamada exitosa: ${cliente.fullName}. ID: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ Error en Vapi (${cliente.fullName}):`,
          err.response?.data || err.message,
        );
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    console.log(`--- FIN PROCESO: ${company} ---\n`);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 ERROR CRÍTICO EN MAKESMARTCALL:", e);
    res.status(500).json({ error: e.message });
  }
};
