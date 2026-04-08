const dynamoDB = require("../services/dynamo");
const {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

exports.login = async (req, res) => {
  const { email: identifier, password } = req.body;
  if (!identifier) {
    return res.status(400).json({ message: "Identificador requerido" });
  }

  const cleanId = identifier.toLowerCase().trim();

  try {
    let user = null;

    const byEmail = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: cleanId },
      }),
    );
    user = byEmail.Item;

    if (!user) {
      const byUser = await dynamoDB.send(
        new QueryCommand({
          TableName: "Users",
          IndexName: "username-index",
          KeyConditionExpression: "username = :u",
          ExpressionAttributeValues: {
            ":u": cleanId,
          },
        }),
      );
      if (byUser.Items?.length > 0) user = byUser.Items[0];
    }

    if (!user) {
      return res.status(404).json({
        message: "El usuario o correo no existe.",
      });
    }

    if (!user.password || user.password === "") {
      return res.status(200).json({
        status: "NEED_REGISTER",
        email: user.email,
      });
    }

    if (!password) {
      return res.status(200).json({ status: "NEED_PASSWORD" });
    }

    if (user.password !== password) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    res.status(200).json({ status: "OK", user });
  } catch (e) {
    console.error("Error en Login:", e);
    res.status(500).json({ error: e.message });
  }
};

exports.completeProfile = async (req, res) => {
  const { email, fullName, username, phoneNumber, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Users",
        Key: { email: email.toLowerCase().trim() },
        UpdateExpression:
          "SET fullName = :fn, username = :un, phoneNumber = :pn, password = :pw, profileCompleted = :pc",
        ExpressionAttributeValues: {
          ":fn": fullName.trim(),
          ":un": username.toLowerCase().trim(),
          ":pn": phoneNumber.trim(),
          ":pw": password,
          ":pc": true,
        },
      }),
    );
    res.status(200).json({ success: true, status: "USER_READY" });
  } catch (e) {
    console.error("Error en CompleteProfile:", e);
    res.status(500).json({ error: e.message });
  }
};

exports.getProfile = async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: "Email requerido" });
  }

  try {
    const response = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: email.toLowerCase().trim() },
      }),
    );

    if (!response.Item) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.status(200).json(response.Item);
  } catch (e) {
    console.error("Error en GetProfile:", e);
    res.status(500).json({ error: e.message });
  }
};
