require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/business", require("./src/routes/business"));
app.use("/api/webhook", require("./src/routes/webhooks"));
app.use("/api/clients", require("./src/routes/client"));
app.use("/api/task", require("./src/routes/task"));
app.use("/api/ai", require("./src/routes/ai"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Genzai API Online: http://192.168.40.7:${PORT}`);
});
