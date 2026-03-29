const dynamoDB = require("../services/dynamo");
const { PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

exports.confirmPayment = async (req, res) => {
  const {
    email,
    company,
    position,
    sellingProduct,
    address,
    paymentId,
    minutes,
    amount,
  } = req.body;
  const emailKey = email.toLowerCase().trim();
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 30);

  try {
    // 1. Registro en Pagos_Genzai (Key: pagold)
    await dynamoDB.send(
      new PutCommand({
        TableName: "Pagos_Genzai",
        Item: {
          pagoId: String(paymentId),
          email: emailKey,
          company,
          position,
          sellingProduct,
          address,
          amount: Number(amount),
          minutesPurchased: Number(minutes),
          paymentDate: new Date().toISOString(),
          expirationDate: expirationDate.toISOString(),
        },
      }),
    );

    // 2. Actualización de GenzaiUsers (Columnas en Inglés)
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "GenzaiUsers",
        Key: { email: emailKey },
        UpdateExpression:
          "SET availableMinutes = :m, planStatus = :s, expirationDate = :v",
        ExpressionAttributeValues: {
          ":m": Number(minutes),
          ":s": "active",
          ":v": expirationDate.toISOString(),
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Payment Error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
