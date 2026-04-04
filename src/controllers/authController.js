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

  // IMPORTANTE: El email suele ir en minúsculas,
  // pero el username "StevenG" debe buscarse tal cual.
  const trimmedId = identifier.trim();

  try {
    let user = null;

    // 1. Buscar por Email (Primary Key)
    // Forzamos minúsculas solo para el email
    const byEmail = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: trimmedId.toLowerCase() },
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
            // Aquí NO usamos toLowerCase() para que encuentre "StevenG"
            ":u": trimmedId,
          },
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

    // 4. Flujo: Existe pero no tiene contraseña (Registro incompleto)
    if (!user.password) {
      return res.status(200).json({
        status: "NEED_REGISTER",
        email: user.email,
      });
    }

    // 5. Existe y tiene contraseña, pero no la envió (Paso 1 del Login)
    if (!password) {
      return res.status(200).json({ status: "NEED_PASSWORD" });
    }

    // 6. Validación de contraseña (Comparación directa)
    if (user.password !== password) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    // Login Exitoso
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
          ":un": username.trim(),
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
