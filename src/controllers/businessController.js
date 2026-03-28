const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();

exports.confirmarTodo = async (req, res) => {
  try {
    const { email, plan, metodo, businessData } = req.body;

    const params = {
      TableName: process.env.USERS_TABLE_NAME || "GenzaiUsers",
      Key: { email: email },
      // #p es el alias para 'plan' (palabra reservada)
      UpdateExpression:
        "set #p = :p, metodoPago = :m, businessInfo = :bi, updatedAt = :t",
      ConditionExpression: "attribute_exists(email)",
      ExpressionAttributeNames: { "#p": "plan" },
      ExpressionAttributeValues: {
        ":p": plan,
        ":m": metodo,
        ":bi": {
          role: businessData.role,
          company: businessData.companyName,
          industry: businessData.industry,
          address: businessData.address,
          isOwner: businessData.isOwner,
        },
        ":t": new Date().toISOString(),
      },
    };

    await dynamoDB.update(params).promise();
    res.status(200).json({ success: true, message: "Datos actualizados" });
  } catch (e) {
    if (e.code === "ConditionalCheckFailedException") {
      return res
        .status(404)
        .json({ error: "El usuario no existe en la base de datos" });
    }
    res.status(500).json({ error: e.message });
  }
};
