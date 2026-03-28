const axios = require("axios");

async function enviarWhatsApp(phone) {
  const cleanPhone = phone.replace(/\D/g, "");
  const hora = new Date().getUTCHours() - 5; // Hora Colombia
  let saludo = "Buenas noches";
  if (hora >= 5 && hora < 12) saludo = "Buenos días";
  else if (hora >= 12 && hora < 18) saludo = "Buenas tardes";

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.META_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: process.env.META_TEMPLATE_NAME,
          language: { code: "es_CO" },
          components: [
            { type: "body", parameters: [{ type: "text", text: saludo }] },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${process.env.META_TOKEN}` } },
    );
    console.log(`📩 WhatsApp enviado a ${cleanPhone}`);
  } catch (error) {
    console.error("❌ Error Meta API:", error.response?.data || error.message);
  }
}

module.exports = { enviarWhatsApp };
