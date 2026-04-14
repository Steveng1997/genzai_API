const docClient = require("../services/dynamo");
const {
  GetCommand,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE_PRODUCTS = process.env.DYNAMODB_TABLE_PRODUCTS;

exports.createProduct = async (req, res) => {
  try {
    const {
      tenantId,
      productId,
      name,
      description,
      price,
      colors,
      productType,
      vehicleData,
    } = req.body;

    if (!tenantId || !productId) {
      return res
        .status(400)
        .json({ error: "tenantId and productId are required" });
    }

    const foodFilter = /food|restaurant|meal|menu|edible|comida|restaurante/i;
    const isFood = foodFilter.test(colors) || foodFilter.test(name);
    const colorValue = isFood ? "N/A" : colors || "N/A";

    let vehicleFields = {};
    const vehicleTypes = ["auto", "vehicle", "car", "coche", "carro"];

    if (vehicleTypes.includes(productType?.toLowerCase())) {
      vehicleFields = {
        brand: vehicleData?.brand || "N/A",
        reference: vehicleData?.reference || "N/A",
        model: vehicleData?.model || "N/A",
        segment: vehicleData?.segment || "N/A",
        fuelType: vehicleData?.fuelType || "N/A",
      };
    }

    const newProduct = {
      tenantId: tenantId.trim(),
      productId: productId.trim(),
      name: (name || "N/A").trim(),
      description: description || "",
      price: Number(price) || 0,
      colors: colorValue,
      productType: productType || "General",
      ...vehicleFields,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_PRODUCTS,
        Item: newProduct,
      }),
    );

    res.status(201).json({ message: "Product created", data: newProduct });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductsByTenant = async (req, res) => {
  const { tenantId } = req.params;
  try {
    if (!tenantId)
      return res.status(400).json({ error: "tenantId is required" });

    const command = new QueryCommand({
      TableName: TABLE_PRODUCTS,
      KeyConditionExpression: "tenantId = :tId",
      ExpressionAttributeValues: { ":tId": tenantId.trim() },
    });

    const data = await docClient.send(command);
    res.status(200).json(data.Items || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { tenantId, productId, updates } = req.body;

    if (!tenantId || !productId || !updates) {
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
      TableName: TABLE_PRODUCTS,
      Key: {
        tenantId: tenantId.trim(),
        productId: productId.trim(),
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

exports.deleteProduct = async (req, res) => {
  const { tenantId, productId } = req.params;
  try {
    if (!tenantId || !productId) {
      return res
        .status(400)
        .json({ error: "tenantId and productId are required" });
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: String(tenantId).trim(),
          productId: String(productId).trim(),
        },
      }),
    );
    res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
