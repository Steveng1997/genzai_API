const dynamoDB = require("../services/dynamo");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
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
  const { search } = req.query;

  try {
    const response = await dynamoDB.send(
      new ScanCommand({
        TableName: "SupportTickets",
      }),
    );

    let tickets = response.Items || [];

    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const mainTickets = tickets.filter((t) => t.isMain === true);

    if (search) {
      const searchTerm = search.toLowerCase().trim();

      const filteredTickets = tickets.filter(
        (t) =>
          t.question.toLowerCase().includes(searchTerm) && t.isMain !== true,
      );

      const results = [...mainTickets, ...filteredTickets];
      return res.status(200).json(results);
    }

    res.status(200).json(mainTickets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
