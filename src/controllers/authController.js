const dynamoDB = require("../services/dynamo");
const {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

exports.login = async (req, res) => {
  const { email: identifier, password } = req.body;
  if (!identifier)
    return res.status(400).json({ message: "Identificador requerido" });

  const trimmedId = identifier.trim();

  try {
    let user = null;

    // 1. Buscar por Email (PK) - Forzamos minúsculas porque los correos suelen ser así
    const byEmail = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: trimmedId.toLowerCase() },
      }),
    );
    user = byEmail.Item;

    // 2. Buscar por Username (GSI) - NO usar toLowerCase() aquí
    if (!user) {
      const byUser = await dynamoDB.send(
        new QueryCommand({
          TableName: "Users",
          IndexName: "username-index",
          KeyConditionExpression: "username = :u",
          ExpressionAttributeValues: { ":u": trimmedId }, // Buscamos "StevenG" tal cual
        }),
      );
      if (byUser.Items?.length > 0) user = byUser.Items[0];
    }

    // 3. Validación de existencia
    if (!user) {
      return res.status(404).json({
        message: "El usuario o correo no existe. Por favor regístrate.",
      });
    }

    // ... resto de tu lógica de password ( NEED_REGISTER, NEED_PASSWORD, OK )
    if (!user.password) {
      return res
        .status(200)
        .json({ status: "NEED_REGISTER", email: user.email });
    }

    if (!password) {
      return res.status(200).json({ status: "NEED_PASSWORD" });
    }

    if (user.password !== password) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    res.status(200).json({ status: "OK", user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.completeProfile = async (req, res) => {
  const { email, fullName, username, phoneNumber, password } = req.body;
  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Users",
        Key: { email: email.toLowerCase().trim() },
        UpdateExpression:
          "SET fullName = :fn, username = :un, phoneNumber = :pn, password = :pw",
        ExpressionAttributeValues: {
          ":fn": fullName,
          ":un": username.toLowerCase().trim(),
          ":pn": phoneNumber,
          ":pw": password,
        },
      }),
    );
    res.status(200).json({ success: true, status: "USER_READY" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
