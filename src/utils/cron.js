const cron = require("node-cron");
const { Nalco } = require("../models/Order");
const { downloadPdf } = require("./nalcoPriceFetch");
const { sendNalcoMessageToUsers } = require("./nalcoWhatsapp");
require('dotenv').config();

const CRON_TIMEZONE = "Asia/Kolkata";

const updateNalcoPrice = async (nalcoPrice) => {
  try {
    const now = new Date();

    // Detect server timezone
    const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    console.log("Server timezone:", serverTimeZone);

    // Calculate today's start and end based on timezone
    let todayStart, todayEnd;

    if (serverTimeZone === "Asia/Calcutta" || serverTimeZone === "Asia/Kolkata") {
      // If already in IST, no need to offset
      todayStart = new Date(now.setHours(0, 0, 0, 0));
      todayEnd = new Date(now.setHours(23, 59, 59, 999));
    } else {
      // Server is in UTC or another timezone, adjust to IST
      const istOffset = 5.5 * 60 * 60 * 1000;
      todayStart = new Date(now.setHours(0, 0, 0, 0) - istOffset);
      todayEnd = new Date(now.setHours(23, 59, 59, 999) - istOffset);
    }

    // Find the latest entry for today
    const existingEntry = await Nalco.findOne({
      date: { $gte: todayStart, $lte: todayEnd },
    }).sort({ date: -1 });

    console.log("Existing entry found:", existingEntry);
    console.log("Today's start:", todayStart);
    console.log("Today's end:", todayEnd);

    if (!existingEntry) {
      console.log("No existing entry found for today, creating a new one.");
      const newNalco = new Nalco({
        nalcoPrice,
        date: new Date(),
      });

      const savedNalco = await newNalco.save();

      return {
        message: "Nalco created for today.",
        nalco: savedNalco,
        changed: false,
        direction: null,
      };
    } else {
      console.log("Existing entry found, checking price...");
      // If the price has changed, update the existing entry
      console.log("Existing price:", existingEntry.nalcoPrice);
      console.log("New price:", nalcoPrice);
      console.log("Price comparison:", existingEntry.nalcoPrice !== nalcoPrice);
      if (existingEntry.nalcoPrice !== nalcoPrice) {
        const previousPrice = existingEntry.nalcoPrice;
        const newNalco = new Nalco({
          nalcoPrice,
          date: new Date(),
        });

        const savedNalco = await newNalco.save();

        return {
          message: "Nalco updated (new price for today).",
          nalco: savedNalco,
          changed: true,
          direction: nalcoPrice > previousPrice ? "increase" : "decrease",
          previousPrice,
        };
      } else {
        return {
          message: "Nalco price unchanged. No update needed.",
          nalco: existingEntry,
          changed: false,
          direction: null,
        };
      }
    }
  } catch (error) {
    console.error(error);
    return null;
  }
};

const shouldSendDailyWhatsappUpdate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: CRON_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return hour === 10 && minute === 0;
};



const runJob = async () => {

  const price = await downloadPdf();

  console.log('Price sending', price);

  if (price) {
    const res = await updateNalcoPrice(price);
    if (res) {
      console.log("Database updated successfully via service");
      if (res.changed || shouldSendDailyWhatsappUpdate()) {
        console.log(
          res.changed
            ? `Nalco ${res.direction} detected; sending WhatsApp update`
            : "Sending scheduled 10:00 AM Nalco WhatsApp update"
        );
        try {
          await sendNalcoMessageToUsers(price);
        } catch (error) {
          console.error("Failed to send Nalco WhatsApp update:", error.message);
        }
      }
    } else {
      console.log("Failed to save new price");
    }
    
  }
};
// runJob();

cron.schedule("*/15 * * * *", runJob, {
  timezone: CRON_TIMEZONE,
});
console.log("Cron job scheduled every 15 minutes");
