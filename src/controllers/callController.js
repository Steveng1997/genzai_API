const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const makeSmartCall = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email del usuario es obligatorio" });

    // 1. Buscar configuración de la IA
    const allConfigs = await dynamoDB.send(
      new ScanCommand({ TableName: "AIConfigs" }),
    );
    const config = allConfigs.Items.find(
      (item) => (item.ownerEmail || "").toLowerCase().trim() === email,
    );

    if (!config) {
      return res
        .status(404)
        .json({
          success: false,
          message: "IA no configurada para este usuario",
        });
    }

    // Aquí iría tu integración con Vapi, Retell o Twilio
    // Usando config.assistantId y config.businessName
    console.log(`Lanzando llamada con Asistente: ${config.assistantId}`);

    res.status(200).json({
      success: true,
      message: `Campaña de ${config.businessName} iniciada`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { makeSmartCall };
