const dynamoDB = require("../services/dynamo");
const {
  PutCommand,
  QueryCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

exports.saveSupportQuery = async (req, res) => {
  const { tenantId, question, answer, currentPlan } = req.body;

  if (!tenantId || !question) {
    return res
      .status(400)
      .json({ message: "tenantId y pregunta son requeridos" });
  }

  try {
    const timestamp = new Date().toISOString();
    const ticketId = `TICKET#${timestamp}#${crypto.randomBytes(3).toString("hex")}`;

    const newTicket = {
      tenantId: tenantId.trim(),
      ticketId: ticketId,
      question: question.trim(),
      answer: answer || "Sin respuesta",
      currentPlan: currentPlan || "N/A",
      createdAt: timestamp,
      status: "COMPLETED",
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: "SupportTickets",
        Item: newTicket,
      }),
    );

    res.status(201).json({ status: "OK", ticketId: ticketId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getAllSupportTickets = async (req, res) => {
  const { tenantId } = req.query;

  if (!tenantId) {
    return res.status(400).json({ message: "tenantId requerido" });
  }

  try {
    const response = await dynamoDB.send(
      new QueryCommand({
        TableName: "SupportTickets",
        KeyConditionExpression: "tenantId = :t",
        ExpressionAttributeValues: {
          ":t": tenantId.trim(),
        },
        ScanIndexForward: false,
      }),
    );

    res.status(200).json(response.Items || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getSupportByPlan = async (req, res) => {
  const { tenantId, currentPlan } = req.query;

  if (!tenantId || !currentPlan) {
    return res
      .status(400)
      .json({ message: "tenantId y currentPlan requeridos" });
  }

  try {
    const response = await dynamoDB.send(
      new QueryCommand({
        TableName: "SupportTickets",
        KeyConditionExpression: "tenantId = :t",
        FilterExpression: "currentPlan = :p",
        ExpressionAttributeValues: {
          ":t": tenantId.trim(),
          ":p": currentPlan.trim(),
        },
        ScanIndexForward: false,
      }),
    );

    res.status(200).json(response.Items || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
