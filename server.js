require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

// --- MIDDLEWARES ---

// Habilitar CORS para peticiones desde Flutter/Web
app.use(cors());

// Parseo de JSON con límite de 50mb (para prompts largos)
app.use(express.json({ limit: "50mb" }));

// Parseo de URL Encoded con límite de 50mb
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Middleware de Logs para monitorear qué llega al server
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- RUTA DE SALUD ---
app.get("/", (req, res) => {
  res.status(200).send("Genzai API is Online and Healthy!");
});

// --- DEFINICIÓN DE RUTAS ---
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/business", require("./src/routes/business"));
app.use("/api/clients", require("./src/routes/client"));
app.use("/api/task", require("./src/routes/task"));
app.use("/api/ai", require("./src/routes/ai")); // Aquí es donde Multer hará su magia
app.use("/api/call", require("./src/routes/call"));
app.use("/api/plan", require("./src/routes/plan"));
app.use("/api/products", require("./src/routes/products"));
app.use("/api/vapi", require("./src/routes/vapi"));

// --- MANEJO DE ERRORES ---

// Error 404: Ruta No Encontrada
app.use((req, res) => {
  console.log(`⚠️ ERROR 404: Ruta no encontrada -> ${req.method} ${req.url}`);
  res.status(404).json({
    error: "Ruta no encontrada",
    message: `La ruta ${req.url} no existe en este servidor.`,
  });
});

// Error 500: Manejador Global (Este capturará fallos en setupAssistant)
app.use((err, req, res, next) => {
  console.error("❌ ERROR GLOBAL DEL SERVIDOR:", err.stack);

  // Si el error viene de Multer (ej: archivo muy grande)
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "El archivo es demasiado grande. El límite es 50MB.",
    });
  }

  res.status(500).json({
    success: false,
    message: "Hubo un error interno en el servidor",
    error: err.message,
  });
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Genzai API Online on port ${PORT}`);
  console.log(`🚀 Preparado para recibir cargas en /api/ai/setup-assistant`);
});
