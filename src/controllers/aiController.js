const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email faltante" });
    }

    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_PAYMENTS }),
    );

    const business = allPayments.Items.find((i) => i.email === email);

    if (!business) {
      return res
        .status(404)
        .json({ success: false, message: "Sin suscripción" });
    }

    const product = business.sellingProduct;

    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${product}`,
      instructions: `Eres la asistente experta en ventas de ${product}. Tu objetivo es cerrar la venta de forma amable.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
        Item: {
          businessId: business.company.toLowerCase().replace(/ /g, "_"),
          ownerEmail: email,
          assistantId: assistant.id,
          businessName: product, // <--- AQUÍ GUARDAMOS "AUTO"
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
