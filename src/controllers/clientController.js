const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

exports.uploadManual = async (req, res) => {
  const { phone, name, ownerEmail } = req.body;

  try {
    await docClient.send(
      new PutCommand({
        TableName: "ClientesRiley",
        Item: {
          Phone: phone, // Partition Key de esta tabla
          Name: name,
          OwnerEmail: ownerEmail, // Tu "Llave foránea"
          Status: "Pendiente_Llamada",
          LastInteraction: new Date().toISOString(),
          ServiceActive: true,
        },
      }),
    );
    res.status(200).json({ message: "Cliente cargado con éxito" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
