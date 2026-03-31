const path = require("path");
// Forzamos la carga del .env usando una ruta absoluta
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { ListTablesCommand } = require("@aws-sdk/client-dynamodb");
// Asegúrate de que esta ruta sea correcta según dónde guardaste check-db.js
const { docClient } = require("./src/config/aws");

async function validarConexion() {
  console.log("------------------------------------------");
  console.log("🔍 Iniciando validación de base de datos...");

  // Verificación de carga de variables
  const region = process.env.AWS_REGION;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;

  console.log(`📍 Región configurada: ${region || "❌ NO ENCONTRADA"}`);
  console.log(
    `🔑 Key ID cargada: ${accessKey ? "✅ SÍ (" + accessKey.substring(0, 5) + "...)" : "❌ NO"}`,
  );

  if (!region || !accessKey) {
    console.error(
      "🛑 ERROR: El archivo .env no se cargó correctamente o faltan variables.",
    );
    console.log(
      "👉 Asegúrate de que el archivo se llame exactamente '.env' y esté en la misma carpeta que este script.",
    );
    return;
  }

  try {
    // 1. Intentar listar las tablas
    const data = await docClient.send(new ListTablesCommand({}));
    console.log("✅ Conexión exitosa con AWS.");
    console.log("📋 Tablas encontradas en AWS:", data.TableNames);

    // 2. Verificar si las tablas necesarias existen (usando tus nombres del .env)
    const tablasRequeridas = [
      process.env.DYNAMODB_TABLE_USERS || "Users",
      process.env.DYNAMODB_TABLE_LEADS || "Clients",
    ];

    console.log("\n🔎 Verificando tablas específicas:");
    tablasRequeridas.forEach((tabla) => {
      if (data.TableNames.includes(tabla)) {
        console.log(`✔️  La tabla '${tabla}' existe.`);
      } else {
        console.log(`❌ La tabla '${tabla}' NO existe en la región ${region}.`);
      }
    });
  } catch (err) {
    console.error("\n🛑 ERROR DE AWS:");
    if (
      err.name === "UnrecognizedClientException" ||
      err.message.includes("credential")
    ) {
      console.error(
        "👉 Las credenciales (Access Key o Secret Key) son INVÁLIDAS.",
      );
      console.error(
        "👉 Revisa que no tengan espacios o comentarios (#) en la misma línea del .env.",
      );
    } else if (err.name === "SignatureDoesNotMatch") {
      console.error("👉 Tu SECRET_ACCESS_KEY es incorrecta.");
    } else {
      console.error(`👉 Detalle técnico: ${err.message}`);
    }
  }
  console.log("------------------------------------------");
}

validarConexion();
