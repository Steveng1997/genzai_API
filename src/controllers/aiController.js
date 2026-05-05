const OpenAI = require("openai");
const { v4: uuidv4 } = require("uuid");
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const dynamoDB = require("../services/dynamo");

const sharp = require("sharp");

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const crypto = require("crypto");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.S3_BUCKET_PRODUCTS;
const TABLE_CONFIGS = process.env.DYNAMODB_TABLE_AI;
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

const updateCounter = async (tenantId, email, isTechnicalSheet) => {
  const isSheet =
    isTechnicalSheet === true ||
    String(isTechnicalSheet).toLowerCase() === "true";
  const field = isSheet ? "totalTechnicalSheets" : "totalProductImages";

  try {
    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_USERS,
        Key: {
          tenantId: tenantId.toString(),
          email: email.toLowerCase().trim(),
        },
        UpdateExpression: `ADD ${field} :inc SET updatedAt = :u`,
        ExpressionAttributeValues: {
          ":inc": 1,
          ":u": new Date().toISOString(),
        },
      }),
    );
    console.log(`✅ CONTADOR: ${field} incrementado para ${email}`);
  } catch (error) {
    console.error("❌ Error DynamoDB Counter:", error.message);
  }
};

const createOpenAIAssistant = async (company) => {
  return await openai.beta.assistants.create({
    name: `Riley - Clasificador - ${company || "Empresa"}`,
    instructions: `Eres Riley. Tu misión es analizar documentos de productos. 
    Detecta si es una FICHA TÉCNICA (isTechnicalSheet: true) con especificaciones, 
    o una IMAGEN comercial (isTechnicalSheet: false). 
    Extrae: name, price, brand, model, reference, stock, description.`,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
  });
};

exports.getChatHistory = async (req, res) => {
  const { tenantId } = req.params;

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    const threadId = Items?.[0]?.activeThreadId;

    if (!threadId) {
      console.log("ℹ️ No hay historial previo para este tenant.");
      return res.status(200).json([]);
    }

    const messages = await openai.beta.threads.messages.list(threadId);

    const history = messages.data
      .map((m) => ({
        role: m.role,
        content: m.content[0]?.text?.value || "",
      }))
      .reverse();

    res.status(200).json(history);
  } catch (e) {
    console.error("❌ Error getChatHistory:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.getConfig = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );
    res.status(200).json(Items?.[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.askRiley = async (req, res) => {
  const { message, tenantId, company } = req.body;
  if (!message || !tenantId)
    return res.status(400).json({ error: "Faltan datos" });

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );
    let Item = Items?.[0];
    let assistantId =
      Item?.openaiAssistantId ||
      (await createOpenAIAssistant(company || Item?.company).then((a) => a.id));
    let agentId = Item?.agentId || uuidv4();
    let threadId = Item?.activeThreadId;

    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      await dynamoDB.send(
        new UpdateCommand({
          TableName: TABLE_CONFIGS,
          Key: { tenantId: tenantId.toString(), agentId: agentId },
          UpdateExpression: "SET activeThreadId = :t",
          ExpressionAttributeValues: { ":t": threadId },
        }),
      );
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });
    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: assistantId,
    });

    if (run.status === "completed") {
      const messagesList = await openai.beta.threads.messages.list(threadId);
      const lastAssistantMessage = messagesList.data.find(
        (m) => m.role === "assistant",
      );
      res.status(200).json({
        reply:
          lastAssistantMessage?.content[0]?.text?.value || "Sin respuesta.",
      });
    } else {
      res.status(500).json({ error: `Status: ${run.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.setupAssistant = async (req, res) => {
  const files = req.files || [];
  const { email, company, tenantId } = req.body;
  if (!tenantId) return res.status(400).json({ message: "tenantId requerido" });

  try {
    const { Items } = await dynamoDB.send(
      new ScanCommand({
        TableName: TABLE_CONFIGS,
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId.toString() },
      }),
    );

    let Item = Items?.[0];
    let assistantId =
      Item?.openaiAssistantId ||
      (await createOpenAIAssistant(company).then((a) => a.id));
    let agentId = Item?.agentId || uuidv4();
    const newFileIds = [];
    const newFileNames = [];

    for (const file of files) {
      console.log(`\n--- INICIO PROCESAMIENTO: ${file.originalname} ---`);
      let mimeTypeForOpenAI = file.mimetype;
      if (
        file.originalname.toLowerCase().endsWith(".pdf") &&
        file.mimetype === "application/octet-stream"
      ) {
        mimeTypeForOpenAI = "application/pdf";
      }

      const fileContext = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname, {
          type: mimeTypeForOpenAI,
        }),
        purpose: "assistants",
      });

      const tempVectorStore = await openai.beta.vectorStores.create({
        name: `Temp-${fileContext.id}`,
        file_ids: [fileContext.id],
      });

      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [tempVectorStore.id] },
        },
      });

      newFileIds.push(fileContext.id);
      newFileNames.push(file.originalname);

      let isSheet = false;
      const nameToTest = file.originalname.toLowerCase();
      const sheetKeywords = ["ficha", "tecnica", "spec", "manual", "datos"];

      if (sheetKeywords.some((k) => nameToTest.includes(k))) {
        isSheet = true;
      }

      if (!isSheet) {
        try {
          const isPDF =
            mimeTypeForOpenAI === "application/pdf" ||
            nameToTest.endsWith(".pdf");
          const isImage =
            file.mimetype.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp)$/.test(nameToTest);

          if (isPDF) {
            const thread = await openai.beta.threads.create({
              messages: [
                {
                  role: "user",
                  content: `¿Es "${file.originalname}" una ficha técnica? Responde JSON: {"isTechnicalSheet": boolean}`,
                  attachments: [
                    {
                      file_id: fileContext.id,
                      tools: [{ type: "file_search" }],
                    },
                  ],
                },
              ],
            });

            const run = await openai.beta.threads.runs.createAndPoll(
              thread.id,
              {
                assistant_id: assistantId,
                instructions: "Responde solo JSON.",
              },
            );

            if (run.status === "completed") {
              const msgs = await openai.beta.threads.messages.list(
                run.thread_id,
              );
              const rawResponse = msgs.data[0].content[0].text.value;
              const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
              if (jsonMatch)
                isSheet = JSON.parse(jsonMatch[0]).isTechnicalSheet === true;
            }
          } else if (isImage) {
            const vision = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: '¿Es ficha técnica? JSON: {"isTechnicalSheet": boolean}',
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
                      },
                    },
                  ],
                },
              ],
              response_format: { type: "json_object" },
            });
            isSheet =
              JSON.parse(vision.choices[0].message.content).isTechnicalSheet ===
              true;
          }
        } catch (err) {
          console.error(`❌ Error analizando contenido:`, err.message);
        }
      }

      await openai.beta.vectorStores.del(tempVectorStore.id);
      if (email) await updateCounter(tenantId, email, isSheet);
    }

    const finalFileIds = [...(Item?.openaiFileIds || []), ...newFileIds];
    const finalFileNames = [...(Item?.fileNames || []), ...newFileNames];

    if (newFileIds.length > 0) {
      const mainVectorStore = await openai.beta.vectorStores.create({
        name: `VS-${tenantId}-${Date.now()}`,
        file_ids: finalFileIds,
      });
      await openai.beta.assistants.update(assistantId, {
        tool_resources: {
          file_search: { vector_store_ids: [mainVectorStore.id] },
        },
      });
    }

    await dynamoDB.send(
      new UpdateCommand({
        TableName: TABLE_CONFIGS,
        Key: { tenantId: tenantId.toString(), agentId: agentId },
        UpdateExpression:
          "SET openaiAssistantId = :oa, openaiFileIds = :f, fileNames = :fn, updatedAt = :u, company = :c, ownerEmail = :e",
        ExpressionAttributeValues: {
          ":oa": assistantId,
          ":f": finalFileIds,
          ":fn": finalFileNames,
          ":u": new Date().toISOString(),
          ":c": company || Item?.company || "Empresa",
          ":e": email?.toLowerCase() || Item?.ownerEmail || "N/A",
        },
      }),
    );
    res.status(200).json({ success: true, assistantId });
  } catch (e) {
    console.error("❌ Error setupAssistant:", e.message);
    res.status(500).json({ error: e.message });
  }
};

exports.analyzeProductImage = async (req, res) => {
  try {
    console.log("--- [INICIO] PROCESO DE ANÁLISIS ---");
    const { tenantId, email } = req.body;
    const file = req.file;

    console.log(`[DATOS RECIBIDOS]: Tenant: ${tenantId}, Email: ${email}`);

    if (!BUCKET_NAME || !file) {
      console.error(
        "❌ [ERROR]: Configuración de S3 o archivo inexistente en el request",
      );
      return res
        .status(400)
        .json({ error: "Configuración incompleta o archivo no recibido" });
    }

    const fileName = file.originalname.toLowerCase();
    let mimeTypeForOpenAI = file.mimetype;

    console.log(
      `[ARCHIVO]: Nombre: ${fileName}, MIME Original: ${file.mimetype}, Tamaño: ${file.size} bytes`,
    );

    // Corrección de MIME para PDFs mal identificados
    if (
      fileName.endsWith(".pdf") &&
      mimeTypeForOpenAI === "application/octet-stream"
    ) {
      mimeTypeForOpenAI = "application/pdf";
      console.log(
        "-> [MIME CORREGIDO]: application/pdf detectado por extensión",
      );
    }

    const isPDF =
      mimeTypeForOpenAI === "application/pdf" || fileName.endsWith(".pdf");
    const isImage =
      mimeTypeForOpenAI.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp)$/.test(fileName);

    console.log(`[TIPO DETECTADO]: isPDF: ${isPDF}, isImage: ${isImage}`);

    const sheetKeywords = [
      "ficha",
      "tecnica",
      "spec",
      "manual",
      "datos",
      "catalog",
      "hoja",
    ];
    const isSheetByKeyword = sheetKeywords.some((k) => fileName.includes(k));

    if (isSheetByKeyword)
      console.log(
        "-> [KEYWORD DETECTADA]: El nombre del archivo sugiere una ficha técnica",
      );

    const extractionPrompt = `
    Analiza el archivo adjunto y extrae la información para un inventario profesional.
    
    ### REGLAS CRÍTICAS PARA "name":
    - NO uses "N/A", "Desconocido" o "Modelo específico" dentro del nombre.
    - Si no encuentras la referencia o el modelo, NO los inventes, simplemente usa los datos disponibles.
    - Formato preferido: "[Marca] [Referencia/Modelo]".

   ### COLUMNAS A LLENAR (Obligatorio):
    1. brand: Marca del producto.
    2. reference: Referencia de fábrica o código alfanumérico.
    3. name: Nombre comercial más descriptivo encontrado.
    4. productType: Tipo específico (ej: Camioneta, Zapatos, Smartphone).
    5. category: Sector (ej: Automotriz, Calzado, Tecnología).
    6. color: Color exacto mencionado. Si es comida o no aplica, usa "N/A".
    7. description: Resumen de características clave (2-3 líneas).
    8. observations: Detalles de seguridad, garantía o mantenimiento.
    9. segment: (Solo autos) Segmento (ej: SUV, Sedán, Hatchback). Si no es auto, usa "".
    10. fuelType: (Solo autos) Combustible (ej: Gasolina, Diésel, Eléctrico). Si no es auto, usa "".
    
    ### RECORTE (Solo imágenes):
    Si hay una foto principal, devuelve coordenadas en "crop": {"x", "y", "width", "height"} (0-1000).
    
    ### REGLA DE VALIDACIÓN PARA isTechnicalSheet:
    - isTechnicalSheet: Debe ser TRUE si el documento contiene tablas técnicas, medidas, especificaciones de ingeniería o componentes detallados. FALSE si es solo publicidad visual.

    Responde ÚNICAMENTE en formato JSON plano.
    `;

    let result = { isTechnicalSheet: isSheetByKeyword };
    let primaryPhotoUrl = "";

    // Generar Key única
    const fileExtension = isPDF ? ".pdf" : ".jpg";
    const fileKey = `products/${tenantId.trim()}/img-${Date.now()}-${crypto.randomUUID()}${fileExtension}`;
    console.log(`[S3 KEY GENERADA]: ${fileKey}`);

    // SUBIDA INICIAL (Respaldo)
    console.log("-> [S3]: Subiendo archivo original como respaldo...");
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Body: file.buffer,
        ContentType: mimeTypeForOpenAI,
      }),
    );
    primaryPhotoUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${fileKey}`;
    console.log(`✅ [S3 URL]: ${primaryPhotoUrl}`);

    if (isImage) {
      console.log("-> [MODO]: Procesando como IMAGEN con GPT-4o Vision...");
      const base64Image = file.buffer.toString("base64");
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${file.mimetype};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      result = JSON.parse(resp.choices[0].message.content);
      console.log("[GPT RESULTADO]:", JSON.stringify(result, null, 2));

      if (result.crop) {
        console.log(
          "-> [SHARP]: Coordenadas de recorte recibidas. Iniciando procesamiento...",
        );
        try {
          const metadata = await sharp(file.buffer).metadata();
          console.log(
            `[SHARP METADATA]: Original: ${metadata.width}x${metadata.height}, Formato: ${metadata.format}`,
          );

          const extractRegion = {
            left: Math.max(
              0,
              Math.round((result.crop.x / 1000) * metadata.width),
            ),
            top: Math.max(
              0,
              Math.round((result.crop.y / 1000) * metadata.height),
            ),
            width: Math.min(
              metadata.width - 1,
              Math.round((result.crop.width / 1000) * metadata.width),
            ),
            height: Math.min(
              metadata.height - 1,
              Math.round((result.crop.height / 1000) * metadata.height),
            ),
          };

          console.log(`[SHARP REGION]: ${JSON.stringify(extractRegion)}`);

          if (extractRegion.width > 0 && extractRegion.height > 0) {
            const croppedBuffer = await sharp(file.buffer)
              .extract(extractRegion)
              .jpeg({ quality: 90 })
              .toBuffer();

            console.log(
              "-> [S3]: Sobrescribiendo archivo en S3 con la versión recortada...",
            );
            await s3Client.send(
              new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: fileKey,
                Body: croppedBuffer,
                ContentType: "image/jpeg",
              }),
            );
            console.log("✅ [S3]: Recorte guardado exitosamente");
          }
        } catch (e) {
          console.error(
            "⚠️ [SHARP ERROR]: Error recortando la imagen:",
            e.message,
          );
        }
      }
    } else if (isPDF) {
      console.log("-> [MODO]: Procesando como PDF con OpenAI Assistants...");
      const f = await openai.files.create({
        file: await OpenAI.toFile(file.buffer, file.originalname, {
          type: mimeTypeForOpenAI,
        }),
        purpose: "assistants",
      });
      console.log(`[OPENAI FILE ID]: ${f.id}`);

      const vs = await openai.beta.vectorStores.create({
        name: `Temp-${uuidv4()}`,
        file_ids: [f.id],
      });
      console.log(`[VECTOR STORE ID]: ${vs.id}`);

      const tempAssistant = await openai.beta.assistants.create({
        name: "Data Extractor",
        instructions:
          "Eres un analista técnico. Extrae datos precisos de documentos y devuélvelos en JSON. Si el documento tiene tablas, extrae cada detalle técnico.",
        model: "gpt-4o",
        tools: [{ type: "file_search" }],
        tool_resources: { file_search: { vector_store_ids: [vs.id] } },
      });

      const thread = await openai.beta.threads.create({
        messages: [
          {
            role: "user",
            content: extractionPrompt,
            attachments: [{ file_id: f.id, tools: [{ type: "file_search" }] }],
          },
        ],
      });

      console.log("-> [OPENAI]: Ejecutando Assistant Run...");
      const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
        assistant_id: tempAssistant.id,
      });

      if (run.status === "completed") {
        const msgs = await openai.beta.threads.messages.list(run.thread_id);
        const rawText = msgs.data[0].content[0].text.value;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
          console.log("[ASSISTANT RESULTADO]: JSON extraído correctamente");
        }
      } else {
        console.error(
          `❌ [OPENAI ERROR]: Run finalizó con status: ${run.status}`,
        );
      }

      console.log("-> [LIMPIEZA]: Eliminando archivos temporales de OpenAI...");
      await Promise.all([
        openai.files.del(f.id),
        openai.beta.vectorStores.del(vs.id),
        openai.beta.assistants.del(tempAssistant.id),
      ]);
    }

    // LÓGICA DE NOMBRE Y CONTADORES
    if (isSheetByKeyword) {
      result.isTechnicalSheet = true;
      console.log("Ficha técnica forzada por keyword en nombre de archivo");
    }

    let finalName = result.name || "";
    finalName = finalName
      .replace(/N\/A/g, "")
      .replace(/Modelo específico/gi, "")
      .replace(/Modelo especifico/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (finalName.length < 3) {
      finalName = `${result.brand || ""} ${result.reference || ""}`.trim();
    }

    const isTech = String(result.isTechnicalSheet).toLowerCase() === "true";
    result.isTechnicalSheet = isTech;
    console.log(
      `[VALIDACIÓN FINAL]: isTechnicalSheet = ${isTech}, Name: ${finalName}`,
    );

    if (email) {
      console.log(`-> [DATABASE]: Actualizando contador para ${email}...`);
      await updateCounter(tenantId, email, isTech);
    }

    console.log("--- [FIN] PROCESO EXITOSO ---");

    res.status(200).json({
      brand: result.brand || "",
      reference: result.reference || "",
      name: finalName,
      productType: result.productType || "",
      category: result.category || "",
      color: result.color || "N/A",
      description: result.description || "",
      observations: result.observations || "",
      segment: result.segment || "",
      fuelType: result.fuelType || "",
      isTechnicalSheet: isTech,
      primaryPhotoUrl: primaryPhotoUrl,
      fileUrls: [primaryPhotoUrl],
    });
  } catch (e) {
    console.error("❌ [ERROR CRÍTICO GENERAL]:", e);
    res
      .status(500)
      .json({ error: "Error procesando el análisis", message: e.message });
  }
};
