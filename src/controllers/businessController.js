const dynamoDB = require("../services/dynamo");
const { PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { getPlanById } = require("./planController");
const crypto = require("crypto");

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

    const tenantId = crypto.randomUUID();

    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_PAYMENTS || "Payments",
        Item: {
          paymentId: paymentId,
          email: emailKey,
          tenantId: tenantId,
          company: company,
          position: position,
          sellingProduct: sellingProduct,
          address: address,
          amount: Number(amount),
          planTitle: planDetails.title,
          minutesPurchased: Number(planDetails.minutes),
          paymentDate: now.toISOString(),
          expirationDate: expirationDate.toISOString(),
        },
      }),
    );

    await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE_USERS || "Users",
        Key: { email: emailKey },
        UpdateExpression:
          "SET availableMinutes = :m, planStatus = :s, expirationDate = :v, currentPlan = :p, whatsappEnabled = :w, company = :c, tenantId = :t",
        ExpressionAttributeValues: {
          ":m": Number(planDetails.minutes),
          ":s": "active",
          ":v": expirationDate.toISOString(),
          ":p": planDetails.title,
          ":w": planDetails.whatsappApi !== "No incluido",
          ":c": company,
          ":t": tenantId,
        },
      }),
    );

    res.status(200).json({
      success: true,
      tenantId: tenantId,
    });
  } catch (e) {
    console.error("Payment Error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
