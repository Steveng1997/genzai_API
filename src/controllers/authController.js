const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

// VALIDACIÓN DE REGISTRO
exports.register = async (req, res) => {
  const { email, fullName, password, username, phoneNumber } = req.body;
  try {
    await docClient.send(
      new PutCommand({
        TableName: "GenzaiUsers",
        Item: {
          email: email.toLowerCase().trim(),
          fullName,
          username,
          password, // Recuerda encriptar luego
          phoneNumber,
          planType: "Gratis",
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(email)",
      }),
    );
    res.status(201).json({ message: "Usuario creado" });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(400).json({ error: "El correo ya existe" });
    }
    res.status(500).json({ error: error.message });
  }
};

// VALIDACIÓN DE LOGIN (ESTA ES LA QUE PROBABLEMENTE FALLA)
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const { Item } = await docClient.send(
      new GetCommand({
        TableName: "GenzaiUsers",
        Key: { email: email.toLowerCase().trim() },
      }),
    );

    if (!Item || Item.password !== password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    res.status(200).json({
      message: "Login exitoso",
      user: { fullName: Item.fullName, email: Item.email },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
