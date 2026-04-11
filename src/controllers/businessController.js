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

    const defaultGoals = ["MONEY", "QUANTITY"];
    await Promise.all(
      defaultGoals.map((goalType) => {
        const goalEndDate = new Date();
        goalEndDate.setDate(now.getDate() + 30);

        return dynamoDB.send(
          new PutCommand({
            TableName: process.env.DYNAMODB_TABLE_GOALS || "Goals",
            Item: {
              tenantId: tenantId,
              goalId: crypto.randomUUID(),
              type: goalType,
              targetValue: 0,
              currentValue: 0,
              days: 30,
              endDate: goalEndDate.toISOString(),
              updatedAt: now.toISOString(),
            },
          }),
        );
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
  const { tenantId, goalId, type, targetValue, days, oldType } = req.body;

  if (!tenantId || !type || targetValue === undefined) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const now = new Date();
    const numDays = Number(days) || 30;
    const goalEndDate = new Date();
    goalEndDate.setDate(now.getDate() + numDays);

    const typeUpper = type.toUpperCase().trim();
    let finalGoalId =
      goalId && goalId !== "null" && goalId !== "" ? goalId : null;

    if (!finalGoalId) {
      const searchType = (oldType && oldType !== "" ? oldType : type)
        .toUpperCase()
        .trim();

      const existing = await dynamoDB.send(
        new QueryCommand({
          TableName: process.env.DYNAMODB_TABLE_GOALS || "Goals",
          KeyConditionExpression: "tenantId = :t",
          ExpressionAttributeValues: { ":t": tenantId },
        }),
      );

      if (existing.Items && existing.Items.length > 0) {
        const matchedGoal = existing.Items.find(
          (item) => item.type.toUpperCase().trim() === searchType,
        );
        if (matchedGoal) {
          finalGoalId = matchedGoal.goalId;
        }
      }
    }

    if (!finalGoalId) {
      return res.status(404).json({
        success: false,
        message:
          "No se encontró el registro para actualizar. Solo se pueden crear metas mediante el pago.",
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE_GOALS || "Goals",
        Key: {
          tenantId: tenantId,
          goalId: finalGoalId,
        },
        UpdateExpression:
          "SET #tp = :type, targetValue = :tv, #d = :days, endDate = :ed, updatedAt = :ua",
        ExpressionAttributeNames: { "#tp": "type", "#d": "days" },
        ExpressionAttributeValues: {
          ":type": typeUpper,
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
