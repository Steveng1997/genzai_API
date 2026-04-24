const docClient = require("../services/dynamo");
const {
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const TABLE_SERVICES = process.env.DYNAMODB_TABLE_SERVICES;

exports.createService = async (req, res) => {
  try {
    const {
      tenantId,
      name,
      category,
      price,
      duration,
      description,
      modality,
      status,
      notes,
      serviceDetails,
    } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const serviceId = crypto.randomUUID();

    const newService = {
      tenantId: tenantId.trim(),
      serviceId: serviceId,
      name: (name || "N/A").trim(),
      category: category || "General",
      price: price || "0",
      duration: duration || "N/A",
      description: description || "",
      modality: modality || "Presencial",
      status: status || "Activo",
      isCompleted: false,
      notes: notes || "",
      serviceDetails: serviceDetails || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_SERVICES,
        Item: newService,
      }),
    );

    res.status(201).json({ message: "Service created", data: newService });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getServicesByTenant = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const command = new QueryCommand({
      TableName: TABLE_SERVICES,
      KeyConditionExpression: "tenantId = :tId",
      ExpressionAttributeValues: { ":tId": tenantId.trim() },
    });

    const data = await docClient.send(command);
    res.status(200).json(data.Items || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getServiceById = async (req, res) => {
  try {
    const { tenantId, serviceId } = req.params;
    const data = await docClient.send(
      new GetCommand({
        TableName: TABLE_SERVICES,
        Key: {
          tenantId: tenantId.trim(),
          serviceId: serviceId.trim(),
        },
      }),
    );

    if (!data.Item) return res.status(404).json({ error: "Service not found" });
    res.status(200).json(data.Item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateService = async (req, res) => {
  try {
    const { tenantId, serviceId, updates } = req.body;

    if (!tenantId || !serviceId || !updates) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let updateExp = "set updatedAt = :u";
    let attrValues = { ":u": new Date().toISOString() };
    let attrNames = {};

    const keys = Object.keys(updates);
    keys.forEach((key, i) => {
      updateExp += `, #field${i} = :v${i}`;
      attrNames[`#field${i}`] = key;
      attrValues[`:v${i}`] = updates[key];
    });

    const command = new UpdateCommand({
      TableName: TABLE_SERVICES,
      Key: {
        tenantId: tenantId.trim(),
        serviceId: serviceId.trim(),
      },
      UpdateExpression: updateExp,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      ReturnValues: "ALL_NEW",
    });

    const result = await docClient.send(command);
    res.status(200).json({ message: "Updated", data: result.Attributes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.completeService = async (req, res) => {
  const { serviceId, isCompleted, tenantId } = req.body;
  try {
    if (!tenantId || !serviceId) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_SERVICES,
        Key: {
          tenantId: String(tenantId).trim(),
          serviceId: Number(serviceId),
        },
        UpdateExpression: "set isCompleted = :val",
        ExpressionAttributeValues: { ":val": isCompleted },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.deleteService = async (req, res) => {
  const { tenantId, serviceId } = req.params;
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_SERVICES,
        Key: {
          tenantId: String(tenantId).trim(),
          serviceId: String(serviceId).trim(),
        },
      }),
    );
    res.status(200).json({ message: "Service deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.countServicesByTenant = async (req, res) => {
  try {
    const data = await docClient.send(
      new QueryCommand({
        TableName: TABLE_SERVICES,
        KeyConditionExpression: "tenantId = :tId",
        ExpressionAttributeValues: { ":tId": req.params.tenantId.trim() },
        Select: "COUNT",
      }),
    );
    res.status(200).json({ count: data.Count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
