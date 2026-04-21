const docClient = require("../services/dynamo");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.S3_BUCKET_PRODUCTS;
const TABLE_PRODUCTS = process.env.DYNAMODB_TABLE_PRODUCTS;

exports.createProduct = async (req, res) => {
  try {
    const {
      tenantId,
      name,
      price,
      description,
      categories,
      status,
      clientIds,
      observations,
      productType,
      vehicleData,
      colors,
      fileBase64,
      fileName,
    } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    let imageUrl = null;
    if (fileBase64 && fileName) {
      const buffer = Buffer.from(fileBase64, "base64");
      const fileKey = `products/${tenantId}/${crypto.randomUUID()}-${fileName}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: fileKey,
          Body: buffer,
          ContentType: "image/jpeg",
        }),
      );

      imageUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
    }

    const productId = crypto.randomUUID();
    const foodFilter = /food|restaurant|meal|menu|edible|comida|restaurante/i;
    const isFood =
      (colors && foodFilter.test(colors)) || (name && foodFilter.test(name));
    const colorValue = isFood ? "N/A" : colors || "N/A";

    let vehicleFields = {};
    const vehicleTypes = ["auto", "vehicle", "car", "coche", "carro"];

    if (productType && vehicleTypes.includes(productType.toLowerCase())) {
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
      productId: productId,
      name: (name || "N/A").trim(),
      price: Number(price) || 0,
      description: description || "",
      categories: categories || [],
      status: status || "Activo",
      productType: productType || "General",
      color: colorValue,
      ...vehicleFields,
      clientIds: clientIds || [],
      observations: observations || "",
      imageUrl: imageUrl,
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
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

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
