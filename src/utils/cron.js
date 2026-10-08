const cron = require("node-cron");
const { Nalco, NalcoNotification } = require("../models/Order");
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

const getIstParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
};

const getIstDateKey = (date = new Date()) => {
  const { year, month, day } = getIstParts(date);
  return `${year}-${month}-${day}`;
};

// pre-window: 9:00-9:59 | daily: 10:00 | quiet: 10:01-10:59 | normal: all other times
const getNalcoSlot = (date = new Date()) => {
  const { hour, minute } = getIstParts(date);
  if (hour === 9) return "pre-window";
  if (hour === 10 && minute === 0) return "daily";
  if (hour === 10) return "quiet";
  return "normal";
};

const shouldSendDailyWhatsappUpdate = (date = new Date()) =>
  getNalcoSlot(date) === "daily";

// Returns "change" | "daily" | "normal" | null (null = do not send)
const decideSendType = async (slot, dateKey, priceChanged) => {
  if (slot === "daily") {
    const record = await NalcoNotification.findOne({ dateKey });
    if (record?.dailySentAt) return null;                    // regular message already sent
    if (record?.changeSentAt) return priceChanged ? "normal" : null; // regular skipped; only send if price changed
    return "daily";
  }
  if (slot === "quiet") {
    if (!priceChanged) return null;
    const record = await NalcoNotification.findOne({ dateKey });
    return record?.dailySentAt ? null : "normal";            // quiet only if the regular message was sent
  }
  if (priceChanged && slot === "pre-window") return "change";
  if (priceChanged && slot === "normal") return "normal";
  return null;
};

const markSent = async (type, dateKey) => {
  const field =
    type === "change" ? "changeSentAt" : type === "daily" ? "dailySentAt" : null;
  if (!field) return; // normal sends need no record
  await NalcoNotification.updateOne(
    { dateKey },
    { $set: { [field]: new Date() } },
    { upsert: true }
  );
};

const runJob = async () => {
  // Fix the time once, so a slow download can't push the run into another slot
  const now = new Date();
  const slot = getNalcoSlot(now);
  const dateKey = getIstDateKey(now);

  const price = await downloadPdf();

  console.log("Price sending", price);

  if (Number.isFinite(Number(price)) && Number(price) > 0) {
    const res = await updateNalcoPrice(price);
    if (res) {
      console.log("Database updated successfully via service");
      try {
        const sendType = await decideSendType(slot, dateKey, res.changed);
        if (sendType) {
          console.log(`Sending Nalco WhatsApp update (type: ${sendType}, slot: ${slot})`);
          await sendNalcoMessageToUsers(price);
          await markSent(sendType, dateKey); // only after a successful send
        } else {
          console.log(`No Nalco WhatsApp update needed (slot: ${slot}, changed: ${res.changed})`);
        }
      } catch (error) {
        console.error("Failed to send Nalco WhatsApp update:", error.message);
      }
    } else {
      console.log("Failed to save new price");
    }
    return;
  }

  // Scrape found no valid price: only the 10:00 regular message falls back to the stored price
  if (slot === "daily") {
    try {
      const sendType = await decideSendType(slot, dateKey, false);
      if (!sendType) {
        console.log("10:00 AM update skipped: a message was already sent between 9 and 10.");
        return;
      }
      const latest = await Nalco.findOne({ nalcoPrice: { $gt: 0 } }).sort({ date: -1 });
      const latestPrice = Number(latest?.nalcoPrice);
      if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
        console.error("Scheduled 10:00 AM Nalco update skipped: no valid price was scraped and no valid database price exists.");
        return;
      }
      console.warn(`No valid NALCO price link was found; sending latest database price ${latestPrice} for the scheduled 10:00 AM update.`);
      await sendNalcoMessageToUsers(latestPrice);
      await markSent(sendType, dateKey);
    } catch (error) {
      console.error("Failed to send stored Nalco price for scheduled WhatsApp update:", error.message);
    }
  }
};
// runJob();

cron.schedule("*/15 * * * *", runJob, {
  timezone: CRON_TIMEZONE,
});
console.log("Cron job scheduled every 15 minutes");

module.exports = { runJob, shouldSendDailyWhatsappUpdate, getNalcoSlot, getIstDateKey, updateNalcoPrice };