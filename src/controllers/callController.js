const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

// Inicialización del cliente con la región de tu captura (us-east-2)
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2",
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

exports.makeSmartCall = async (req, res) => {
  try {
    // Extraemos los datos enviados desde Flutter
    const { phone, businessId } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Número de teléfono requerido",
      });
    }

    // Configuración de la consulta a DynamoDB
    const params = {
      // Nombre de la tabla desde tu variable de entorno en App Runner
      TableName: process.env.DYNAMODB_TABLE_LEADS,
      Key: {
        // Conversión explícita a Number (Tipo N en tu tabla Clients)
        phone: Number(phone),
      },
    };

    console.log(`📡 Buscando en ${params.TableName} el teléfono: ${phone}`);

    const { Item } = await ddbDocClient.send(new GetCommand(params));

    if (!Item) {
      return res.status(404).json({
        success: false,
        message: "El cliente no existe en la base de datos de Leads",
      });
    }

    // --- LÓGICA DE LLAMADA (Vapi / OpenAI / Twilio) ---
    // Aquí usarías 'Item' que contiene toda la info del cliente (nombre, etc.)
    console.log(
      `✅ Cliente encontrado: ${Item.name || "Sin nombre"}. Iniciando Riley...`,
    );

    // Respuesta al frontend
    return res.status(200).json({
      success: true,
      message: `Llamada iniciada para ${Item.name || "el cliente"}`,
      contact: Item,
    });
  } catch (error) {
    console.error("❌ Error Crítico:", error);

    // Manejo de error específico de AWS
    if (error.name === "ResourceNotFoundException") {
      return res.status(500).json({
        error: "Configuración incorrecta: La tabla no existe en esta región.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Error interno del servidor al procesar la campaña",
    });
  }
};
