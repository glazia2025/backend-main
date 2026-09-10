const axios = require("axios");
const { randomUUID } = require("crypto");
const User = require("../models/User");

const normalizeIndianPhoneNumber = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return "";
};

const sendNalcoMessageToUsers = async (nalcoPrice) => {
  const price = Number(nalcoPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("A valid Nalco price is required for WhatsApp notification");
  }

  const metaToken = process.env.META_TOKEN;
  const metaNumberId = process.env.META_NUMID;
  if (!metaToken || !metaNumberId) {
    throw new Error("META_TOKEN and META_NUMID are required for WhatsApp notification");
  }

  const users = await User.find({}, { phoneNumber: 1, phoneNumbers: 1 }).lean();
  const recipients = Array.from(
    new Set(
      users
        .map((user) => user.phoneNumber || user.phoneNumbers?.[0])
        .map(normalizeIndianPhoneNumber)
        .filter(Boolean)
    )
  );

  const broadcastId = randomUUID();
  const results = [];
  const batchSize = 10;
  for (let index = 0; index < recipients.length; index += batchSize) {
    const batch = recipients.slice(index, index + batchSize);
    const settled = await Promise.allSettled(
      batch.map((recipient) =>
        axios.post(
          `https://graph.facebook.com/v22.0/${metaNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            to: recipient,
            type: "template",
            template: {
              name: "daily_update",
              language: { code: "en" },
              components: [
                {
                  type: "body",
                  parameters: [{ type: "text", text: String(price / 1000) }],
                },
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${metaToken}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        )
      )
    );
    settled.forEach((result, offset) => {
      const entry = {
        timestamp: new Date().toISOString(),
        broadcastId,
        recipient: batch[offset],
        template: "daily_update",
        nalcoPrice: price,
      };
      if (result.status === "fulfilled") {
        const response = result.value;
        const message = response.data?.messages?.[0];
        console.log("NALCO_WHATSAPP_RECIPIENT", JSON.stringify({
          ...entry,
          status: message?.message_status || "api_accepted",
          httpStatus: response.status,
          messageId: message?.id || null,
        }));
      } else {
        const error = result.reason;
        const metaError = error?.response?.data?.error;
        console.error("NALCO_WHATSAPP_RECIPIENT", JSON.stringify({
          ...entry,
          status: error?.response ? "api_failed" : "request_outcome_unknown",
          httpStatus: error?.response?.status || null,
          errorCode: metaError?.code || error?.code || null,
          errorSubcode: metaError?.error_subcode || null,
          errorMessage: metaError?.message || error?.message || "Request failed",
          errorDetails: metaError?.error_data?.details || null,
          traceId: metaError?.fbtrace_id || null,
        }));
      }
    });
    results.push(...settled);
  }

  const sent = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - sent;
  console.log(`Nalco WhatsApp update completed: ${sent} API requests accepted, ${failed} failed or unknown; broadcastId=${broadcastId}`);

  return { recipients: recipients.length, sent, failed };
};

module.exports = {
  normalizeIndianPhoneNumber,
  sendNalcoMessageToUsers,
};
