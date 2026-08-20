const axios = require("axios");

const normalizeIndianPhoneNumber = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
};

const safeFileName = (value) => {
  const normalized = String(value || "quotation.pdf")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`;
};

const shareQuotationOnWhatsApp = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Quotation PDF is required" });
    }

    const recipient = normalizeIndianPhoneNumber(req.body?.phone);
    if (!recipient) {
      return res.status(400).json({ message: "A valid 10-digit Indian customer phone number is required" });
    }

    const metaToken = process.env.META_TOKEN;
    const metaNumberId = process.env.META_NUMID;
    if (!metaToken || !metaNumberId) {
      return res.status(503).json({ message: "Meta WhatsApp connection is not configured" });
    }

    const fileName = safeFileName(req.file.originalname);
    const uploadForm = new FormData();
    uploadForm.append("messaging_product", "whatsapp");
    uploadForm.append(
      "file",
      new Blob([req.file.buffer], { type: "application/pdf" }),
      fileName
    );

    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v22.0/${metaNumberId}/media`,
      uploadForm,
      {
        headers: { Authorization: `Bearer ${metaToken}` },
        timeout: 30000,
      }
    );

    const mediaId = uploadResponse.data?.id;
    if (!mediaId) throw new Error("Meta did not return an uploaded media id");

    const customerName = String(req.body?.customerName || "Customer").trim() || "Customer";
    const quotationNumber = String(req.body?.quotationNumber || "").trim();
    const caption = `Hello ${customerName}, please find your quotation${quotationNumber ? ` ${quotationNumber}` : ""} attached.`;

    const messageResponse = await axios.post(
      `https://graph.facebook.com/v22.0/${metaNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "document",
        document: {
          id: mediaId,
          filename: fileName,
          caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${metaToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return res.status(200).json({
      message: "Quotation shared successfully",
      recipient,
      messageId: messageResponse.data?.messages?.[0]?.id || "",
    });
  } catch (error) {
    console.error("Quotation WhatsApp share failed:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      message: error.response?.data?.error?.message || "Failed to share quotation on WhatsApp",
    });
  }
};

module.exports = {
  normalizeIndianPhoneNumber,
  shareQuotationOnWhatsApp,
};
