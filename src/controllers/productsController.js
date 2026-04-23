const docClient = require("../services/dynamo");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");
const path = require("path");

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.S3_BUCKET_PRODUCTS;
const TABLE_PRODUCTS = process.env.DYNAMODB_TABLE_PRODUCTS;

const getContentType = (fileName) => {
  const ext = path.extname(fileName).toLowerCase();
  const mimes = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  return mimes[ext] || "application/octet-stream";
};

exports.createProduct = async (req, res) => {
  console.log("=== INICIO CREATE PRODUCT ===");
  try {
    const {
      tenantId,
      name,
      price,
      description,
      category,
      status,
      stock,
      observations,
      productType,
      vehicleData,
      colors,
      files,
    } = req.body;

    if (!BUCKET_NAME) {
      console.error(
        "❌ ERROR: La variable S3_BUCKET_PRODUCTS no está definida.",
      );
      throw new Error("S3 Bucket name is missing in environment variables");
    }

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    let fileUrls = [];
    let primaryPhotoUrl = "";

    if (files && Array.isArray(files)) {
      for (const [index, file] of files.entries()) {
        if (file.fileBase64 && file.fileName) {
          console.log(`Subiendo archivo [${index}]: ${file.fileName}`);
          const buffer = Buffer.from(file.fileBase64, "base64");
          const fileKey = `products/${tenantId.trim()}/${crypto.randomUUID()}-${file.fileName}`;
          const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${fileKey}`;

          await s3Client.send(
            new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileKey,
              Body: buffer,
              ContentType: getContentType(file.fileName),
            }),
          );

          fileUrls.push(s3Url);
          if (file.isPrimary) primaryPhotoUrl = s3Url;
        }
      }
      if (!primaryPhotoUrl && fileUrls.length > 0)
        primaryPhotoUrl = fileUrls[0];
    }

    const productId = crypto.randomUUID();
    const newProduct = {
      tenantId: tenantId.trim(),
      productId,
      name: (name || "N/A").trim(),
      price: Number(price) || 0,
      description: description || "",
      category: category || "General",
      status: status || "Activo",
      stock: Number(stock) || 0,
      productType: productType || "General",
      color: colors || "N/A",
      observations: observations || "",
      fileUrls,
      primaryPhotoUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const vehicleTypes = ["auto", "vehicle", "car", "coche", "carro"];
    if (productType && vehicleTypes.includes(productType.toLowerCase())) {
      Object.assign(newProduct, {
        brand: vehicleData?.brand || "N/A",
        reference: vehicleData?.reference || "N/A",
        model: vehicleData?.model || "N/A",
      });
    }

    await docClient.send(
      new PutCommand({ TableName: TABLE_PRODUCTS, Item: newProduct }),
    );

    console.log("✅ Producto creado con éxito:", productId);
    res.status(201).json({ message: "Product created", data: newProduct });
  } catch (error) {
    console.error("=== ERROR EN CREATE PRODUCT ===");
    res.status(500).json({ error: error.message });
  }
};

exports.getProductsByTenant = async (req, res) => {
  try {
    const data = await docClient.send(
      new QueryCommand({
        TableName: TABLE_PRODUCTS,
        KeyConditionExpression: "tenantId = :tId",
        ExpressionAttributeValues: { ":tId": req.params.tenantId.trim() },
      }),
    );
    res.status(200).json(data.Items || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const { tenantId, productId } = req.params;
    const data = await docClient.send(
      new GetCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: tenantId.trim(),
          productId: productId.trim(),
        },
      }),
    );
    if (!data.Item) return res.status(404).json({ error: "Product not found" });
    res.status(200).json(data.Item);
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

    const currentData = await docClient.send(
      new GetCommand({
        TableName: TABLE_PRODUCTS,
        Key: { tenantId: tenantId.trim(), productId: productId.trim() },
      }),
    );

    if (!currentData.Item) {
      return res.status(404).json({ error: "Product not found" });
    }

    const oldProduct = currentData.Item;

    if (updates.files && Array.isArray(updates.files)) {
      const oldUrls = oldProduct.fileUrls || [];
      let newFileUrls = [];
      let newPrimaryPhotoUrl = "";

      for (const file of updates.files) {
        if (file.fileBase64 && file.fileName) {
          const buffer = Buffer.from(file.fileBase64, "base64");
          const fileKey = `products/${tenantId.trim()}/${crypto.randomUUID()}-${file.fileName}`;
          const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${fileKey}`;

          await s3Client.send(
            new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileKey,
              Body: buffer,
              ContentType: getContentType(file.fileName),
            }),
          );
          newFileUrls.push(s3Url);
          if (file.isPrimary) newPrimaryPhotoUrl = s3Url;
        } else if (file.url) {
          newFileUrls.push(file.url);
          if (file.isPrimary) newPrimaryPhotoUrl = file.url;
        }
      }

      const urlsToDelete = oldUrls.filter((url) => !newFileUrls.includes(url));
      for (const url of urlsToDelete) {
        try {
          const key = url.split(".com/")[1];
          await s3Client.send(
            new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
          );
        } catch (s3Err) {
          console.error("Error deleting from S3:", s3Err);
        }
      }

      if (!newPrimaryPhotoUrl && newFileUrls.length > 0)
        newPrimaryPhotoUrl = newFileUrls[0];

      updates.fileUrls = newFileUrls;
      updates.primaryPhotoUrl = newPrimaryPhotoUrl;
      delete updates.files;
    }

    let updateExp = "set updatedAt = :u";
    let attrValues = { ":u": new Date().toISOString() };
    let attrNames = {};

    Object.keys(updates).forEach((key, i) => {
      updateExp += `, #f${i} = :v${i}`;
      attrNames[`#f${i}`] = key;
      attrValues[`:v${i}`] = updates[key];
    });

    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: tenantId.trim(),
          productId: productId.trim(),
        },
        UpdateExpression: updateExp,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
        ReturnValues: "ALL_NEW",
      }),
    );
    res.status(200).json({ message: "Updated", data: result.Attributes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const data = await docClient.send(
      new GetCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: req.params.tenantId.trim(),
          productId: req.params.productId.trim(),
        },
      }),
    );

    if (data.Item && data.Item.fileUrls) {
      for (const url of data.Item.fileUrls) {
        const key = url.split(".com/")[1];
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
        );
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: req.params.tenantId.trim(),
          productId: req.params.productId.trim(),
        },
      }),
    );
    res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.countProductsByTenant = async (req, res) => {
  try {
    const data = await docClient.send(
      new QueryCommand({
        TableName: TABLE_PRODUCTS,
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
