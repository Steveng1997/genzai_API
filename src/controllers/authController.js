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

  const cleanId = identifier.toLowerCase().trim();

  try {
    let user = null;

    // 1. Intento por Email (PK)
    const byEmail = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: cleanId },
      }),
    );
    user = byEmail.Item;

    // 2. Intento por Username (GSI) si no se encontró por email
    if (!user) {
      const byUser = await dynamoDB.send(
        new QueryCommand({
          TableName: "Users",
          IndexName: "username-index",
          KeyConditionExpression: "username = :u",
          ExpressionAttributeValues: { ":u": cleanId },
        }),
      );
      if (byUser.Items?.length > 0) user = byUser.Items[0];
    }

    if (!user)
      return res.status(404).json({ message: "Usuario no encontrado" });

    // 3. Flujo de validación
    if (!user.password) {
      return res
        .status(200)
        .json({ status: "NEED_REGISTER", email: user.email });
    }

    if (!password) {
      return res
        .status(200)
        .json({ status: "NEED_PASSWORD", message: "Ingrese clave" });
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
