const docClient = require("../services/dynamo");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
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

    console.log("Payload recibido para tenantId:", tenantId);
    console.log("Cantidad de archivos recibidos:", files ? files.length : 0);

    if (!tenantId) {
      console.error("ERROR: tenantId es null o undefined");
      return res.status(400).json({ error: "tenantId is required" });
    }

    let fileUrls = [];
    let primaryPhotoUrl = "";

    if (files && Array.isArray(files)) {
      console.log("Procesando archivos...");
      for (const [index, file] of files.entries()) {
        if (file.fileBase64 && file.fileName) {
          console.log(`Subiendo archivo [${index}]: ${file.fileName}`);

          const buffer = Buffer.from(file.fileBase64, "base64");
          const fileKey = `products/${tenantId}/${crypto.randomUUID()}-${file.fileName}`;
          const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

          try {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: fileKey,
                Body: buffer,
                ContentType: getContentType(file.fileName),
              }),
            );
            console.log(`Archivo [${index}] subido exitosamente: ${s3Url}`);

            fileUrls.push(s3Url);
            if (file.isPrimary) {
              primaryPhotoUrl = s3Url;
              console.log("Foto primaria establecida:", primaryPhotoUrl);
            }
          } catch (s3Error) {
            console.error(
              `ERROR subiendo archivo [${index}] a S3:`,
              s3Error.message,
            );
            throw s3Error;
          }
        }
      }
      if (!primaryPhotoUrl && fileUrls.length > 0) {
        primaryPhotoUrl = fileUrls[0];
        console.log("No se marcó primaria, usando la primera por defecto.");
      }
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
      console.log("Detectado tipo Vehículo, asignando datos extra...");
      Object.assign(newProduct, {
        brand: vehicleData?.brand || "N/A",
        reference: vehicleData?.reference || "N/A",
        model: vehicleData?.model || "N/A",
      });
    }

    console.log("Intentando guardar en DynamoDB...");
    await docClient.send(
      new PutCommand({ TableName: TABLE_PRODUCTS, Item: newProduct }),
    );

    console.log("Producto creado con éxito en DynamoDB ID:", productId);
    res.status(201).json({ message: "Product created", data: newProduct });
  } catch (error) {
    console.error("=== ERROR CRÍTICO EN CREATE PRODUCT ===");
    console.error("Mensaje:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({ error: error.message });
  }
};

exports.getProductsByTenant = async (req, res) => {
  console.log(`Buscando productos para tenant: ${req.params.tenantId}`);
  try {
    const data = await docClient.send(
      new QueryCommand({
        TableName: TABLE_PRODUCTS,
        KeyConditionExpression: "tenantId = :tId",
        ExpressionAttributeValues: { ":tId": req.params.tenantId.trim() },
      }),
    );
    console.log(`Productos encontrados: ${data.Items ? data.Items.length : 0}`);
    res.status(200).json(data.Items || []);
  } catch (error) {
    console.error("Error en getProductsByTenant:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  console.log("Iniciando actualización de producto...");
  try {
    const { tenantId, productId, updates } = req.body;
    console.log(`Actualizando ID: ${productId} para Tenant: ${tenantId}`);

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
        Key: { tenantId: tenantId.trim(), productId: productId.trim() },
        UpdateExpression: updateExp,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
        ReturnValues: "ALL_NEW",
      }),
    );
    console.log("Actualización exitosa en DynamoDB.");
    res.status(200).json({ message: "Updated", data: result.Attributes });
  } catch (error) {
    console.error("Error en updateProduct:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  console.log(
    `Eliminando producto ${req.params.productId} del tenant ${req.params.tenantId}`,
  );
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_PRODUCTS,
        Key: {
          tenantId: req.params.tenantId.trim(),
          productId: req.params.productId.trim(),
        },
      }),
    );
    console.log("Producto eliminado correctamente.");
    res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    console.error("Error en deleteProduct:", error.message);
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
    console.error("Error en countProductsByTenant:", error.message);
    res.status(500).json({ error: error.message });
  }
};
