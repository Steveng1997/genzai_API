const dynamoDB = require("../services/dynamo");
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await dynamoDB.send(
      new GetCommand({
        TableName: "Users",
        Key: { email: normalizedEmail },
      }),
    );

    // 1. Verificar si el usuario existe en la tabla
    if (!result.Item) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const user = result.Item;

    // 2. Verificar si el usuario ya completó su registro (tiene password)
    if (!user.password) {
      return res.status(200).json({ status: "NEED_REGISTER", user });
    }

    // 3. Si existe pero no se envió el password desde Flutter, pedirlo
    if (!password) {
      return res.status(200).json({
        status: "NEED_PASSWORD",
        message: "Usuario encontrado, ingrese su clave",
      });
    }

    // 4. Validar contraseña
    if (user.password !== password) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    // 5. Login exitoso
    res.status(200).json({ status: "OK", user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.completeProfile = async (req, res) => {
  const { email, fullName, username, phoneNumber, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: "Users",
        Key: { email: normalizedEmail },
        UpdateExpression:
          "SET fullName = :fn, username = :un, phoneNumber = :pn, password = :pw",
        ExpressionAttributeValues: {
          ":fn": fullName,
          ":un": username,
          ":pn": phoneNumber,
          ":pw": password, // Se guarda estrictamente como 'password'
        },
      }),
    );
    res.status(200).json({ success: true, status: "USER_READY" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
