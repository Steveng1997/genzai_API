const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS || "Clients";

exports.getAllClients = async (req, res) => {
  let { tenantId } = req.query;
  tenantId = (tenantId || "").trim();

  try {
    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "El tenantId es requerido para filtrar clientes" });
    }

    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": tenantId },
    });

    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    console.error("Error getAllClients:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
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
    } = req.body;

    tenantId = (tenantId || "").trim();
    company = (company || "").trim();
    const cleanPhone = Number(phone);

    if (!cleanPhone || !tenantId) {
      return res
        .status(400)
        .json({ error: "El teléfono y el tenantId son obligatorios" });
    }

    const clientItem = {
      phone: cleanPhone,
      tenantId: tenantId,
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
    console.error("Error saveClient:", error);
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
    res.status(200).json({ message: "Cliente eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
