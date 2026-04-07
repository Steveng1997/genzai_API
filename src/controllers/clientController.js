const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.getAllClients = async (req, res) => {
  const { company } = req.query;
  try {
    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "company = :c",
      ExpressionAttributeValues: { ":c": company },
    });
    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
};

exports.saveClient = async (req, res) => {
  try {
    const {
      fullName,
      identification,
      phone,
      city,
      createdAt,
      call_active,
      company,
    } = req.body;

    if (!phone || !company) {
      return res
        .status(400)
        .json({ error: "El teléfono y la compañía son obligatorios" });
    }

    const clientItem = {
      phone: Number(phone),
      company: company,
      fullName: fullName || "N/A",
      identification: identification || "N/A",
      city: city || "N/A",
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
    const { phone } = req.params;
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_CLIENTS,
        Key: { phone: Number(phone) },
      }),
    );
    res.status(200).json({ message: "Eliminado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
