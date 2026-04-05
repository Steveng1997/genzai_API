const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.setupAssistant = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email faltante" });

    const allPayments = await dynamoDB.send(
      new ScanCommand({ TableName: process.env.DYNAMODB_TABLE_PAYMENTS }),
    );
    const business = allPayments.Items.find((i) => i.email === email);

    if (!business)
      return res
        .status(404)
        .json({ success: false, message: "Sin suscripción" });

    let fileIds = [];
    if (req.files) {
      for (const file of req.files) {
        const f = await openai.files.create({
          file: fs.createReadStream(file.path),
          purpose: "assistants",
        });
        fileIds.push(f.id);
      }
    }

    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${business.company}`,
      instructions: `Eres la asistente de ${business.company}.`,
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });

    // CUMPLIENDO CON LA KEY businessId
    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_AI,
        Item: {
          businessId: business.company.toLowerCase().replace(/ /g, "_"),
          ownerEmail: email,
          assistantId: assistant.id,
          businessName: business.company,
          updatedAt: new Date().toISOString(),
        },
      }),
    );

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
