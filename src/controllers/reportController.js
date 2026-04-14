const OpenAI = require("openai");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_REPORTS = process.env.DYNAMODB_TABLE_REPORTS || "BusinessReports";

exports.handleVapiWebhook = async (req, res) => {
  const payload = req.body;

  if (payload.message?.type !== "end-of-call-report") {
    return res.status(200).send();
  }

  const { call, transcript, customer } = payload.message;
  const { tenantId, company } = call.metadata || {};

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Eres un analista de ventas experto para la empresa "${company}". 
          Analiza la transcripción de la llamada y genera un JSON con:
          - status: ("Cierre", "Interesado", "Descartado")
          - resumen: (Breve resumen del negocio)
          - producto: (Producto del que se habló)
          - tipo_pago: (Si se mencionó, sino "N/A")
          - feedback_cliente: (Por qué no le gustó algo o qué le llamó la atención)`,
        },
        { role: "user", content: `Transcripción: ${transcript}` },
      ],
      response_format: { type: "json_object" },
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // Guardar en DynamoDB
    const reportItem = {
      tenantId: tenantId || "unknown",
      callId: call.id,
      customerName: customer?.name || "Cliente Desconocido",
      customerPhone: customer?.number || "Sin número",
      status: analysis.status,
      summary: analysis.resumen,
      product: analysis.producto,
      paymentMethod: analysis.tipo_pago,
      customerInsight: analysis.feedback_cliente,
      createdAt: new Date().toISOString(),
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: TABLE_REPORTS,
        Item: reportItem,
      }),
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error al procesar el informe:", error);
    res.status(500).json({ message: "Error interno" });
  }
};
