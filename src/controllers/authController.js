const dynamoDB = require("../services/dynamo");
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await dynamoDB.send(
      new GetCommand({
        TableName: "GenzaiUsers",
        Key: { email: email.toLowerCase().trim() },
      }),
    );

    if (!result.Item)
      return res.status(404).json({ message: "User not found" });
    const user = result.Item;

    // Validación de expiración
    if (user.expirationDate && new Date() > new Date(user.expirationDate)) {
      return res
        .status(403)
        .json({ status: "EXPIRED", message: "Plan expired." });
    }

    if (!user.password)
      return res.status(200).json({ status: "NEED_REGISTER", user });
    if (user.password !== password)
      return res.status(401).json({ message: "Invalid password" });

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
        TableName: "GenzaiUsers",
        Key: { email: email.toLowerCase().trim() },
        UpdateExpression:
          "SET fullName = :fn, username = :un, phoneNumber = :pn, password = :pw",
        ExpressionAttributeValues: {
          ":fn": fullName,
          ":un": username,
          ":pn": phoneNumber,
          ":pw": password,
        },
      }),
    );
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
