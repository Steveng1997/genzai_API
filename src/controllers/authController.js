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

  // NORMALIZACIÓN: Todo a minúsculas y sin espacios
  const cleanId = identifier.toLowerCase().trim();

  try {
    let user = null;

    // 1. Buscar por Email (Primary Key)
    const byEmail = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: cleanId },
      }),
    );
    user = byEmail.Item;

    // 2. Buscar por Username (GSI) si no se encontró por email
    if (!user) {
      const byUser = await dynamoDB.send(
        new QueryCommand({
          TableName: "Users",
          IndexName: "username-index",
          KeyConditionExpression: "username = :u",
          ExpressionAttributeValues: {
            ":u": cleanId, // Ahora buscamos siempre en minúsculas
          },
        }),
      );
      if (byUser.Items?.length > 0) user = byUser.Items[0];
    }

    if (!user) {
      return res.status(404).json({
        message: "El usuario o correo no existe. Por favor regístrate.",
      });
    }

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
          "SET fullName = :fn, username = :un, phoneNumber = :pn, password = :pw",
        ExpressionAttributeValues: {
          ":fn": fullName,
          // TRANSFORMACIÓN: Guardamos el username siempre en minúsculas
          ":un": username.toLowerCase().trim(),
          ":pn": phoneNumber,
          ":pw": password,
        },
      }),
    );
    res.status(200).json({ success: true, status: "USER_READY" });
  } catch (e) {
    console.error("Error en CompleteProfile:", e);
    res.status(500).json({ error: e.message });
  }
};
