require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Crear carpeta uploads si no existe (Vital para que Multer no falle con 404/500)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Log de peticiones para debug (Verás cada intento de Flutter aquí)
app.use((req, res, next) => {
  console.log(`📡 Solicitud recibida: ${req.method} ${req.url}`);
  next();
});

// Rutas
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/business", require("./src/routes/business"));
app.use("/api/clients", require("./src/routes/client"));
app.use("/api/task", require("./src/routes/task"));
app.use("/api/ai", require("./src/routes/ai"));
app.use("/api/call", require("./src/routes/call"));
app.use("/api/plan", require("./src/routes/plan"));

app.get("/", (req, res) => {
  res.status(200).send("Genzai API is Online and Healthy!");
});

// CAPTURADOR DE 404 (Si Flutter falla, esto te dirá la ruta exacta en el log)
app.use((req, res) => {
  console.log(`⚠️ ERROR 404: Ruta no encontrada -> ${req.method} ${req.url}`);
  res.status(404).json({
    error: "Ruta no encontrada",
    message: `La ruta ${req.url} no existe en este servidor.`,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Genzai API Online on port ${PORT}`);
});
