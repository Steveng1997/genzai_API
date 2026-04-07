const dynamoDB = require("../services/dynamo");
const { PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { getPlanById } = require("./planController");

exports.confirmPayment = async (req, res) => {
  const {
    email,
    company,
    position,
    sellingProduct,
    address,
    paymentId,
    planId,
    amount,
  } = req.body;

  const emailKey = email.toLowerCase().trim();

  try {
    const planDetails = await getPlanById(planId);

    if (!planDetails) {
      return res
        .status(404)
        .json({ success: false, message: "Plan definitions not found." });
    }

    const now = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(now.getDate() + 30);

    // Guardar en la tabla de Pagos
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_PAYMENTS || "Payments",
        Item: {
          paymentId: paymentId,
          email: emailKey,
          company: company,
          position: position,
          sellingProduct: sellingProduct,
          address: address,
          amount: Number(amount),
          planTitle: planDetails.title,
          minutesPurchased: Number(planDetails.minutes), // Según image_5dcdaa.png
          paymentDate: now.toISOString(),
          expirationDate: expirationDate.toISOString(),
        },
      }),
    );

    // Actualizar el perfil del Usuario con su compañía y expiración
    await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE_USERS || "Users",
        Key: { email: emailKey },
        UpdateExpression:
          "SET availableMinutes = :m, planStatus = :s, expirationDate = :v, currentPlan = :p, whatsappEnabled = :w, company = :c",
        ExpressionAttributeValues: {
          ":m": Number(planDetails.minutes),
          ":s": "active",
          ":v": expirationDate.toISOString(),
          ":p": planDetails.title,
          ":w": planDetails.whatsappApi !== "No incluido",
          ":c": company, // Agregado para diferenciar por compañía
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Payment Error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
