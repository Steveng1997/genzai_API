const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TABLE_PAYMENTS = "Payments";
const TABLE_AI_CONFIGS = "AIConfigs";

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const company = (req.body.company || "").trim();

    if (!email || !company) {
      return res
        .status(400)
        .json({ message: "Identificación de empresa y usuario requerida." });
    }

    const paymentsResponse = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_PAYMENTS,
        FilterExpression: "email = :e AND company = :c",
        ExpressionAttributeValues: { ":e": email, ":c": company },
      }),
    );

    const businessData = paymentsResponse.Items && paymentsResponse.Items[0];
    const productDescription = businessData
      ? businessData.sellingProduct
      : "productos generales";

    const fileIds = [];
    for (const file of files) {
      const uploadResponse = await openai.files.create({
        file: fs.createReadStream(file.path),
        purpose: "assistants",
      });
      fileIds.push(uploadResponse.id);
    }

    const assistant = await openai.beta.assistants.create({
      name: `Riley - ${company}`,
      instructions: `Eres Riley, la asistente de "${company}". Especialista en "${productDescription}". Solo usa tus archivos para responder. Si detectas un compromiso, usa la herramienta de creación de tareas.`,
      model: "gpt-4o",
      tools: [
        { type: "file_search" },
        { type: "code_interpreter" },
        {
          type: "function",
          function: {
            name: "create_task",
            parameters: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                detalle: { type: "string" },
                company: { type: "string" },
              },
              required: ["titulo", "company"],
            },
          },
        },
      ],
      tool_resources: {
        file_search: {
          vector_stores: fileIds.length > 0 ? [{ file_ids: fileIds }] : [],
        },
      },
    });

    const aiConfigItem = {
      businessId: company,
      ownerEmail: email,
      openaiAssistantId: assistant.id,
      assistantId: "4c266662-68db-4046-a13f-8c021c84919c",
      businessName: company,
      updatedAt: new Date().toISOString(),
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_AI_CONFIGS, Item: aiConfigItem }),
    );

    res
      .status(200)
      .json({
        success: true,
        message: "Entrenamiento completado para " + company,
      });
  } catch (e) {
    res.status(500).json({ message: "Error técnico", error: e.message });
  } finally {
    files.forEach((f) => {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
  }
};
