const dynamoDB = require("../services/dynamo");
const {
  PutCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { getPlanById } = require("./planController");
const crypto = require("crypto");

exports.processPayment = async (req, res) => {
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
        TableName: process.env.DYNAMODB_TABLE_PAYMENTS,
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
        TableName: process.env.DYNAMODB_TABLE_USERS,
        Key: {
          tenantId: tenantId,
          email: emailKey,
        },
        UpdateExpression:
          "SET availableMinutes = :m, planStatus = :s, expirationDate = :v, currentPlan = :p, whatsappEnabled = :w, company = :c",
        ExpressionAttributeValues: {
          ":m": Number(planDetails.minutes),
          ":s": "active",
          ":v": expirationDate.toISOString(),
          ":p": planDetails.title,
          ":w": planDetails.whatsappApi !== "No incluido",
          ":c": company,
        },
      }),
    );

    const goalEndDate = new Date();
    goalEndDate.setDate(now.getDate() + 30);

    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS,
        Item: {
          tenantId: tenantId,
          goalId: crypto.randomUUID(),
          nameGoals: "DINERO",
          targetValue: 0,
          currentValue: 0,
          days: 30,
          endDate: goalEndDate.toISOString(),
          updatedAt: now.toISOString(),
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
  const { tenantId, goalId, nameGoals, targetValue, days } = req.body;

  if (!tenantId || !nameGoals || targetValue === undefined) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const now = new Date();
    const numDays = Number(days) || 30;
    const goalEndDate = new Date();
    goalEndDate.setDate(now.getDate() + numDays);

    const nameUpper = nameGoals.toUpperCase().trim();
    let finalGoalId =
      goalId && goalId !== "null" && goalId !== "" ? goalId : null;

    if (!finalGoalId) {
      const existing = await dynamoDB.send(
        new QueryCommand({
          TableName: process.env.DYNAMODB_TABLE_GOALS,
          KeyConditionExpression: "tenantId = :t",
          ExpressionAttributeValues: { ":t": tenantId },
        }),
      );

      if (existing.Items && existing.Items.length > 0) {
        finalGoalId = existing.Items[0].goalId;
      }
    }

    if (!finalGoalId) {
      return res.status(404).json({
        success: false,
        message: "No se encontró el registro para actualizar.",
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS,
        Key: {
          tenantId: tenantId,
          goalId: finalGoalId,
        },
        UpdateExpression:
          "SET nameGoals = :ng, targetValue = :tv, #d = :days, endDate = :ed, updatedAt = :ua",
        ExpressionAttributeNames: { "#d": "days" },
        ExpressionAttributeValues: {
          ":ng": nameUpper,
          ":tv": Number(targetValue),
          ":days": numDays,
          ":ed": goalEndDate.toISOString(),
          ":ua": now.toISOString(),
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Update Goal Error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getGoals = async (req, res) => {
  const { tenantId } = req.params;

  try {
    const data = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS,
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

exports.getPayments = async (req, res) => {
  const { tenantId } = req.params;

  try {
    const data = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE_PAYMENTS,
        IndexName: "TenantIdIndex",
        KeyConditionExpression: "tenantId = :t",
        ExpressionAttributeValues: {
          ":t": tenantId,
        },
      }),
    );

    res.status(200).json(data.Items);
  } catch (e) {
    console.error("Get Payments Error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
