const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

// Obtener todos los clientes
exports.getAllClients = async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
    });
    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes" });
  }
};

// Crear o Modificar (Upsert)
exports.saveClient = async (req, res) => {
  try {
    const { fullName, identification, phone, city, createdAt } = req.body;

    // Validación y Conversión Crítica a Número (Tipo N en Dynamo)
    if (!phone)
      return res.status(400).json({ error: "El teléfono es obligatorio" });
    const finalPhone = Number(phone);
    if (isNaN(finalPhone))
      return res.status(400).json({ error: "Teléfono inválido" });

    const clientItem = {
      phone: finalPhone, // Key Primaria
      fullName: fullName || "N/A",
      identification: identification || "N/A",
      city: city || "N/A",
      updatedAt: new Date().toISOString(),
      // Si el frontend envía createdAt, lo mantenemos (Modificación), si no, es nuevo.
      createdAt: createdAt || new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
        Item: clientItem,
      }),
    );

    res.status(200).json(clientItem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Eliminar cliente
exports.deleteClient = async (req, res) => {
  try {
    const { phone } = req.params;
    await docClient.send(
      new DeleteCommand({
        TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
        Key: { phone: Number(phone) },
      }),
    );
    res.status(200).json({ message: "Eliminado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
