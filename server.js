require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use((req, res, next) => {
  console.log(`📡 Solicitud recibida: ${req.method} ${req.url}`);
  next();
});

app.get("/", (req, res) => {
  res.status(200).send("Genzai API is Online and Healthy!");
});

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/business", require("./src/routes/business"));
app.use("/api/clients", require("./src/routes/client"));
app.use("/api/task", require("./src/routes/task"));
app.use("/api/ai", require("./src/routes/ai"));
app.use("/api/call", require("./src/routes/call"));
app.use("/api/plan", require("./src/routes/plan"));
app.use("/api/products", require("./src/routes/products"));
app.use("/api/report", require("./src/routes/report"));

app.use((req, res) => {
  console.log(`⚠️ ERROR 404: Ruta no encontrada -> ${req.method} ${req.url}`);
  res.status(404).json({
    error: "Ruta no encontrada",
    message: `La ruta ${req.url} no existe en este servidor.`,
  });
});

app.use((err, req, res, next) => {
  console.error("❌ ERROR GLOBAL DEL SERVIDOR:", err.stack);
  res.status(500).json({
    success: false,
    message: "Hubo un error interno en el servidor",
    error: err.message,
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Genzai API Online on port ${PORT}`);
  console.log(`📂 Carpeta de subidas lista en: ${uploadDir}`);
});
