const docClient = require("../services/dynamo");
const {
  ScanCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

// 1. Obtener todos los clientes
exports.getAllClients = async (req, res) => {
  try {
    const command = new ScanCommand({
      // Asegúrate de actualizar tu .env a DYNAMODB_TABLE_CLIENTS=Clients
      TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
    });
    const response = await docClient.send(command);
    res.status(200).json(response.Items || []);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ error: "Database error" });
  }
};

// 2. Crear o Actualizar cliente
exports.createClient = async (req, res) => {
  try {
    const { fullName, identification, phone, city, Phone } = req.body;

    // Aceptamos ambos, pero priorizamos el valor numérico
    const rawPhone = Phone || phone;

    if (!rawPhone) {
      return res.status(400).json({ error: "The 'Phone' key is required" });
    }

    // CONVERSIÓN CRÍTICA: Forzamos que sea un número para que coincida con el tipo (N) en AWS
    const finalPhone = Number(rawPhone);

    if (isNaN(finalPhone)) {
      return res.status(400).json({ error: "Phone must be a valid number" });
    }

    const clientItem = {
      phone: finalPhone, // Clave Primaria corregida a minúscula según tu nueva tabla
      fullName: fullName || "N/A",
      identification: identification || "N/A",
      city: city || "N/A",
      updatedAt: new Date().toISOString(),
    };

    if (!req.body.updatedAt) {
      clientItem.createdAt = new Date().toISOString();
    }

    const command = new PutCommand({
      TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
      Item: clientItem,
    });

    await docClient.send(command);
    res.status(201).json(clientItem);
  } catch (error) {
    console.error("Error saving client:", error);
    res.status(500).json({ error: error.message });
  }
};

// 3. Eliminar cliente
exports.deleteClient = async (req, res) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({ error: "Phone parameter is required" });
    }

    const command = new DeleteCommand({
      TableName: process.env.DYNAMODB_TABLE_CLIENTS || "Clients",
      Key: {
        // CONVERSIÓN CRÍTICA: El ID que viene de la URL es String, hay que pasarlo a Number
        phone: Number(phone),
      },
    });

    await docClient.send(command);
    res.status(200).json({ message: "Client deleted successfully" });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({ error: error.message });
  }
};
