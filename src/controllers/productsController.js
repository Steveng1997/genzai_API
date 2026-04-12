const { dynamoDb } = require("../config/awsConfig");

const createProduct = async (req, res) => {
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
      tenantId,
      productId,
      name,
      description: description || "",
      price: Number(price) || 0,
      colors: colorValue,
      productType: productType || "General",
      ...vehicleFields,
      createdAt: new Date().toISOString(),
    };

    await dynamoDb
      .put({
        TableName: "Products",
        Item: newProduct,
      })
      .promise();

    res.status(201).json({ message: "Product created", data: newProduct });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProductsByTenant = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const params = {
      TableName: "Products",
      KeyConditionExpression: "tenantId = :tId",
      ExpressionAttributeValues: { ":tId": tenantId },
    };

    const data = await dynamoDb.query(params).promise();
    res.json(data.Items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { tenantId, productId, updates } = req.body;

    if (!tenantId || !productId) {
      return res.status(400).json({ error: "Missing primary keys" });
    }

    let updateExp = "set ";
    let attrValues = {};
    const keys = Object.keys(updates);

    keys.forEach((key, i) => {
      updateExp += `${key} = :v${i}${i < keys.length - 1 ? ", " : ""}`;
      attrValues[`:v${i}`] = updates[key];
    });

    const params = {
      TableName: "Products",
      Key: { tenantId, productId },
      UpdateExpression: updateExp,
      ExpressionAttributeValues: attrValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await dynamoDb.update(params).promise();
    res.json({ message: "Updated", data: result.Attributes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteProduct = async (req, res) => {
  const { tenantId, productId } = req.params;
  try {
    await dynamoDb
      .delete({
        TableName: "Products",
        Key: { tenantId, productId },
      })
      .promise();
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createProduct,
  getProductsByTenant,
  updateProduct,
  deleteProduct,
};
