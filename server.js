require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

// --- MIDDLEWARE ---
// Habilitamos CORS para permitir peticiones desde Flutter (IP local)
app.use(cors());
// Permitimos que el servidor entienda JSON en el body de las peticiones
app.use(express.json());

// --- RUTAS ---
// Importamos las rutas asegurando que apunten a la carpeta 'src'
try {
  const businessRoutes = require("./src/routes/business");
  const authRoutes = require("./src/routes/auth");

  app.use("/api/business", businessRoutes);
  app.use("/api/auth", authRoutes);
} catch (error) {
  console.error(
    "❌ Error cargando rutas: Verifica que los archivos existan en src/routes/",
    error.message,
  );
}

// --- RUTA DE SALUD ---
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "🚀 API de Genzai operando correctamente",
  });
});

// --- MANEJO DE ERRORES GLOBAL ---
app.use((err, req, res, next) => {
  console.error("❌ Error no controlado:", err.stack);
  res.status(500).json({ error: "Ocurrió un error en el servidor" });
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 8080;
// Escuchamos en '0.0.0.0' para que sea accesible desde el emulador/celular en la misma red
app.listen(PORT, "0.0.0.0", () => {
  const IP_LOCAL = "192.168.40.7"; // Tu IP actual según la terminal
  console.log(`\n🚀 Servidor Genzai activo en http://${IP_LOCAL}:${PORT}`);
  console.log(`🔗 Auth Login: http://${IP_LOCAL}:${PORT}/api/auth/login`);
  console.log(
    `🔗 Business Confirm: http://${IP_LOCAL}:${PORT}/api/business/confirmar-todo\n`,
  );
});
