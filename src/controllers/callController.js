const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const axios = require("axios");

const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";
const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.makeSmartCall = async (req, res) => {
  const { company } = req.body;
  console.log(
    `\n[${new Date().toISOString()}] --- INICIO PROCESO DE LLAMADA: ${company} ---`,
  );

  try {
    if (!company) {
      console.error("❌ Error: Compañía no proporcionada");
      return res.status(400).json({ message: "Compañía requerida" });
    }

    const { Item: config } = await dynamoDB.send(
      new GetCommand({
        TableName: TABLE_CONFIGS,
        Key: { businessId: company },
      }),
    );

    if (!config) {
      console.error(`❌ Error: No se encontró configuración para ${company}`);
      return res.status(404).json({ message: "No hay IA configurada" });
    }

    const { Items: clientes } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CLIENTS,
        FilterExpression: "company = :c",
        ExpressionAttributeValues: { ":c": company },
      }),
    );

    const clientesParaLlamar = (clientes || []).filter(
      (c) => c.call_active === true,
    );

    console.log(
      `📊 Total: ${clientes?.length || 0} | Activos: ${clientesParaLlamar.length}`,
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
                    content: `Eres Riley, un asesor experto de la empresa ${company}. Tu interlocutor es ${cliente.fullName}.
                    
                    SALUDO INICIAL: Debe ser exactamente: "${saludoTemporal} ${cliente.fullName}, ¿cómo te encuentras el día de hoy?".
                    
                    REGLAS DE PRODUCTOS:
                    1. Solo ofrece los vehículos que aparecen en los archivos PDF de tu base de conocimientos.
                    2. Si el cliente pide un vehículo que NO está en los documentos (como un Mazda 3 o cualquier otro), responde: "En este momento no tengo ese modelo en inventario, pero puedo agendarte una cita con un asesor para ayudarte a conseguirlo".
                    3. Si acepta la cita o quiere hablar con alguien humano, usa la herramienta 'handleRileyTool' para registrar la tarea con estos datos:
                       - titulo: Cita Interés Vehículo - ${cliente.fullName}
                       - detalle: Interés en vehículo no disponible en PDF o solicita asesoría.
                       - company: ${company}`,
                  },
                ],
              },
            },
            phoneNumberId:
              config.vapiPhoneNumberId ||
              "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
            metadata: { company },
          },
          { headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` } },
        );

        console.log(
          `✅ Llamada aceptada para ${cliente.fullName}. ID: ${response.data.id}`,
        );
        return response.data;
      } catch (err) {
        console.error(
          `❌ Error Vapi (${cliente.fullName}):`,
          err.response?.data || err.message,
        );
        return { error: true, client: cliente.fullName };
      }
    });

    const results = await Promise.all(calls);
    console.log(`--- FIN PROCESO: ${company} ---\n`);
    res.status(200).json({ success: true, results });
  } catch (e) {
    console.error("🔥 ERROR CRÍTICO:", e);
    res.status(500).json({ error: e.message });
  }
};
