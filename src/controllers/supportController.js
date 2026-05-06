const dynamoDB = require("../services/dynamo");
const { PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

exports.saveSupportQuery = async (req, res) => {
  const { tenantId, question, answer, isMain } = req.body;

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
      isMain: isMain || false,
      createdAt: timestamp,
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
  const { tenantId, search } = req.query;

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

    let tickets = response.Items || [];
    const mainTickets = tickets.filter((t) => t.isMain === true).slice(0, 10);

    if (search) {
      const searchTerm = search.toLowerCase().trim();

      const filteredTickets = tickets.filter(
        (t) =>
          t.question.toLowerCase().includes(searchTerm) && t.isMain !== true,
      );

      const results = [...mainTickets, ...filteredTickets];
      return res.status(200).json(results);
    }

    res.status(200).json(tickets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
