const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const TABLE_CLIENTS = process.env.DYNAMODB_TABLE_LEADS;

exports.getAllClients = async (req, res) => {
  let { tenantId } = req.query;
  try {
    if (!tenantId)
      return res.status(400).json({ error: "El tenantId es requerido" });
    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": tenantId.trim() },
    });
    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
};

exports.getClientCount = async (req, res) => {
  let { tenantId } = req.query;
  try {
    if (!tenantId) return res.status(400).json({ error: "tenantId requerido" });
    const command = new ScanCommand({
      TableName: TABLE_CLIENTS,
      FilterExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": tenantId.trim() },
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
      email,
      city,
      company,
      tenantId,
      clientId,
      status,
      origin,
      priority,
      mainInterest,
      nextStep,
      contactChannel,
      notes,
      createdAt,
    } = req.body;

    if (!tenantId)
      return res.status(400).json({ error: "El tenantId es obligatorio" });

    const endChannels = Array.isArray(contactChannel)
      ? contactChannel
      : [contactChannel.toString().trim()];

    const isCallActive = endChannels.some((c) =>
      c.toString().toLowerCase().includes("llamada"),
    );

    const clientItem = {
      tenantId: tenantId.trim(),
      clientId: clientId || uuidv4(),
      fullName: (fullName || "N/A").trim(),
      identification: (identification || "N/A").trim(),
      phone: phone ? Number(phone) : 0,
      email: (email || "N/A").trim(),
      city: (city || "N/A").trim(),
      company: (company || "N/A").trim(),
      status: status || "NUEVO",
      origin: origin || "WhatsApp",
      priority: priority || "Media",
      mainInterest: mainInterest || "",
      nextStep: nextStep || "",
      contactChannel: endChannels,
      notes: notes || "",
      call_active: isCallActive,
      updatedAt: new Date().toISOString(),
      createdAt: createdAt || new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({ TableName: TABLE_CLIENTS, Item: clientItem }),
    );

    res.status(200).json(clientItem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateBasicInfo = async (req, res) => {
  try {
    const {
      tenantId,
      clientId,
      fullName,
      phone,
      email,
      identification,
      status,
      city,
      origin,
      priority,
      mainInterest,
      nextStep,
      contactChannel,
      notes,
    } = req.body;

    if (!tenantId || !clientId)
      return res
        .status(400)
        .json({ error: "tenantId y clientId son requeridos" });

    const endChannels = Array.isArray(contactChannel)
      ? contactChannel
      : [contactChannel ? contactChannel.toString().trim() : "Llamada"];

    const isCallActive = endChannels.some((c) =>
      c.toString().toLowerCase().includes("llamada"),
    );

    const command = new UpdateCommand({
      TableName: TABLE_CLIENTS,
      Key: { tenantId: tenantId.trim(), clientId: clientId.trim() },
      UpdateExpression: `set
        fullName = :n,
        phone = :p,
        email = :e,
        identification = :i,
        #st = :s,
        city = :ct,
        origin = :or,
        priority = :pr,
        mainInterest = :mi,
        nextStep = :ns,
        contactChannel = :cc,
        notes = :nt,
        call_active = :ca,
        updatedAt = :u`,
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":n": (fullName || "N/A").trim(),
        ":p": phone ? Number(phone) : 0,
        ":e": (email || "N/A").trim(),
        ":i": (identification || "N/A").trim(),
        ":s": status || "NUEVO",
        ":ct": (city || "N/A").trim(),
        ":or": origin || "WhatsApp",
        ":pr": priority || "Media",
        ":mi": mainInterest || "",
        ":ns": nextStep || "",
        ":cc": endChannels,
        ":nt": notes || "",
        ":ca": isCallActive,
        ":u": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    });

    const response = await docClient.send(command);
    res.status(200).json(response.Attributes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const { tenantId, clientId } = req.params;
    if (!tenantId || !clientId)
      return res
        .status(400)
        .json({ error: "tenantId y clientId son obligatorios" });

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
