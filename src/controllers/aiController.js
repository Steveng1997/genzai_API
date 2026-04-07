const OpenAI = require("openai");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TABLE_PAYMENTS = process.env.DYNAMODB_TABLE_PAYMENTS || "Payments";
const TABLE_AI_CONFIGS = process.env.DYNAMODB_TABLE_AI || "AIConfigs";

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const { company } = req.body;

    if (!email || !company) {
      return res
        .status(400)
        .json({ message: "Faltan datos: email y company." });
    }

    const paymentsResponse = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_PAYMENTS,
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email },
      }),
    );

    const businessData = paymentsResponse.Items?.[0];
    if (!businessData) {
      return res.status(404).json({ message: "Suscripción no encontrada." });
    }

    const productDescription =
      businessData.sellingProduct || "servicios generales";
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
      instructions: `Eres Riley, asistente de "${company}". Especialista en "${productDescription}". Usa tus documentos, excels e imágenes para responder de forma profesional.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }, { type: "code_interpreter" }],
      tool_resources: {
        file_search: {
          vector_stores: fileIds.length > 0 ? [{ file_ids: fileIds }] : [],
        },
        code_interpreter: {
          file_ids: fileIds,
        },
      },
    });

    const aiConfigItem = {
      businessId: company,
      ownerEmail: email,
      openaiAssistantId: assistant.id,
      assistantId: "4c266662-68db-4046-a13f-8c021c84919c",
      vapiPhoneNumberId:
        process.env.VAPI_PHONE_NUMBER_ID ||
        "59d1cef7-80b8-4dfa-9a14-1394df3bc97a",
      businessName: company,
      product: productDescription,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await dynamoDB.send(
      new PutCommand({ TableName: TABLE_AI_CONFIGS, Item: aiConfigItem }),
    );

    res.status(200).json({
      success: true,
      message: "Riley configurada correctamente",
      assistantId: assistant.id,
    });
  } catch (e) {
    res.status(500).json({ message: "Error en servidor", error: e.message });
  } finally {
    files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
  }
};
