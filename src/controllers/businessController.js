const dynamoDB = require("../services/dynamo");
const {
  PutCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
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

exports.upsertGoal = async (req, res) => {
  const { tenantId, type, targetValue, days } = req.body;

  if (!tenantId || !type || !targetValue) {
    return res.status(400).json({
      success: false,
      message: "Required fields missing",
    });
  }

  try {
    const goalItem = {
      tenantId: tenantId,
      type: type,
      targetValue: Number(targetValue),
      currentValue: 0,
      days: Number(days || 30),
      updatedAt: new Date().toISOString(),
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS || "Goals",
        Item: goalItem,
      }),
    );

    res.status(200).json({
      success: true,
      goal: goalItem,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getGoals = async (req, res) => {
  const { tenantId } = req.query;

  if (!tenantId) {
    return res
      .status(400)
      .json({ success: false, message: "tenantId required" });
  }

  try {
    const data = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS || "Goals",
        KeyConditionExpression: "tenantId = :t",
        ExpressionAttributeValues: {
          ":t": tenantId,
        },
      }),
    );

    res.status(200).json(data.Items);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
