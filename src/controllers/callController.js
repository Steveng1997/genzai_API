const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2",
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

exports.makeSmartCall = async (req, res) => {
  try {
    const { businessId } = req.body;

    // 1. Escaneamos TODA la tabla de clientes configurada en App Runner
    const params = {
      TableName: process.env.DYNAMODB_TABLE_LEADS,
    };

    const { Items } = await ddbDocClient.send(new ScanCommand(params));

    if (!Items || Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hay clientes en la tabla para iniciar la campaña.",
      });
    }

    console.log(`🚀 Iniciando campaña masiva para ${Items.length} clientes...`);

    // 2. Procesamos las llamadas (Lógica asíncrona para no bloquear el servidor)
    Items.forEach(async (cliente) => {
      const telefono = cliente.phone;
      const nombre = cliente.fullName || "Cliente";

      try {
        // AQUÍ LLAMAS A TU FUNCIÓN DE RILEY / VAPI
        console.log(`📞 Llamando a ${nombre} al número: ${telefono}`);
        // await vapi.startCall(telefono, ...);
      } catch (err) {
        console.error(`❌ Error llamando a ${telefono}:`, err.message);
      }
    });

    // 3. Respondemos de inmediato al App que la campaña arrancó
    return res.status(200).json({
      success: true,
      message: `Campaña iniciada para ${Items.length} clientes correctamente.`,
    });
  } catch (error) {
    console.error("❌ Error en Campaña Masiva:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error al procesar la campaña masiva.",
      });
  }
};
