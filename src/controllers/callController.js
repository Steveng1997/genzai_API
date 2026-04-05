const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-2",
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

exports.makeSmartCall = async (req, res) => {
  try {
    const { phone, businessId } = req.body;

    if (!phone)
      return res
        .status(400)
        .json({ success: false, message: "Número requerido" });

    // Limpieza dinámica: dejamos solo números y añadimos 57 si falta
    let cleanPhone = phone.toString().replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = "57" + cleanPhone;

    const params = {
      TableName: process.env.DYNAMODB_TABLE_LEADS, // Variable de tu App Runner
      Key: { phone: Number(cleanPhone) }, // (N) en tu DynamoDB
    };

    const { Item } = await ddbDocClient.send(new GetCommand(params));

    if (!Item) {
      return res.status(404).json({
        success: false,
        message: `El cliente ${cleanPhone} no existe en la base de datos.`,
      });
    }

    // Lógica de éxito
    return res.status(200).json({
      success: true,
      message: `Llamada iniciada para ${Item.fullName || "el cliente"}`,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Error interno del servidor" });
  }
};
