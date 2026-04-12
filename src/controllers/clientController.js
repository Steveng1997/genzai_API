const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.getAllClients = async (req, res) => {
  let { tenantId } = req.query;
  tenantId = (tenantId || "").trim();

  try {
    if (!tenantId) {
      return res.status(400).json({ error: "El tenantId es requerido" });
    }

    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": tenantId },
    });

    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
};

exports.getClientCount = async (req, res) => {
  let { tenantId } = req.query;
  tenantId = (tenantId || "").trim();

  try {
    if (!tenantId) return res.status(400).json({ error: "tenantId requerido" });

    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": tenantId },
      Select: "COUNT",
    });

    const response = await docClient.send(command);
    res.status(200).json({ count: response.Count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.saveClient = async (req, res) => {
  try {
    let {
      fullName,
      identification,
      phone,
      city,
      createdAt,
      call_active,
      company,
      tenantId,
      clientId,
    } = req.body;

    tenantId = (tenantId || "").trim();
    const cleanPhone = Number(phone);

    if (!tenantId) {
      return res.status(400).json({ error: "El tenantId es obligatorio" });
    }

    const clientItem = {
      tenantId: tenantId,
      clientId: clientId || uuidv4(),
      phone: cleanPhone,
      company: company,
      fullName: (fullName || "N/A").trim(),
      identification: (identification || "N/A").trim(),
      city: (city || "N/A").trim(),
      call_active: call_active !== undefined ? call_active : true,
      updatedAt: new Date().toISOString(),
      createdAt: createdAt || new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_CLIENTS,
        Item: clientItem,
      }),
    );

    res.status(200).json(clientItem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const { tenantId, clientId } = req.params;

    if (!tenantId || !clientId) {
      return res
        .status(400)
        .json({ error: "tenantId y clientId son obligatorios" });
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_CLIENTS,
        Key: {
          tenantId: String(tenantId).trim(),
          clientId: String(clientId).trim(),
        },
      }),
    );

    res.status(200).json({ message: "Cliente eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
