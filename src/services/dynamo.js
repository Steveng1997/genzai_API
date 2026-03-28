const {
  UpdateCommand,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

// Registrar el dueño de la cuenta (App Flutter)
async function registrarNuevoUsuario(userData) {
  return await docClient.send(
    new PutCommand({
      TableName: "GenzaiUsers",
      Item: {
        ...userData,
        status: "Pendiente_Plan", // Luego cambia a 'Activo' tras pagar
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(email)",
    }),
  );
}

// Subir clientes desde Excel o Input manual
async function guardarClienteManual(cliente) {
  return await docClient.send(
    new PutCommand({
      TableName: process.env.DYNAMO_TABLE_NAME, // ClientesRiley
      Item: {
        Phone: cliente.phone,
        Name: cliente.name,
        OwnerEmail: cliente.ownerEmail,
        Status: "Pendiente_Llamada",
        LastInteraction: new Date().toISOString(),
        ServiceActive: true,
      },
    }),
  );
}

module.exports = { registrarNuevoUsuario, guardarClienteManual };
