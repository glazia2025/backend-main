const cron = require("node-cron");
const fs = require("fs");
const { Nalco } = require("../models/Order");
const User = require('../models/User');
const { downloadPdf } = require("./nalcoPriceFetch");
require('dotenv').config();

const META_TOKEN=process.env.META_TOKEN;
const META_NUMID=process.env.META_NUMID;

const sendNalcoMessageToUsers = async (nalcoPrice) => {
  try {
    // Logic to send message to users
    console.log("Sending Nalco price to users:", nalcoPrice);
    const users = await User.find();
    console.log(`Found ${users.length} users to notify`);
    for(const user of users) {
      const targetNumber = user.phoneNumber || (user.phoneNumbers && user.phoneNumbers[0]);
      if (targetNumber) {
          const axios = require('axios');
          let data = JSON.stringify({
            "messaging_product": "whatsapp",
            "to": `91${targetNumber}`,
            "type": "template",
            "template": {
              "name": "daily_update",
              "language": {
                "code": "en"
              },
              "components": [
                {
                  "type": "body",
                  "parameters": [
                    {
                      "type": "text",
                      "text": nalcoPrice/1000
                    }
                  ]
                }
              ]
            }
          });

          let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: `https://graph.facebook.com/v22.0/${META_NUMID}/messages`,
            headers: { 
              'Authorization': `Bearer ${META_TOKEN}`, 
              'Content-Type': 'application/json'
            },
            data : data
          };

          axios.request(config)
          .then((response) => {
            console.log(JSON.stringify(response.data));
          })
          .catch((error) => {
            console.log(error);
          });

      }
    }
    
  } catch (error) {
    console.error('Error sending SMS message:', error);
  }
}


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

    
    sendNalcoMessageToUsers(nalcoPrice);

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
      };
    } else {
      console.log("Existing entry found, checking price...");
      // If the price has changed, update the existing entry
      console.log("Existing price:", existingEntry.nalcoPrice);
      console.log("New price:", nalcoPrice);
      console.log("Price comparison:", existingEntry.nalcoPrice !== nalcoPrice);
      if (existingEntry.nalcoPrice !== nalcoPrice) {
        const newNalco = new Nalco({
          nalcoPrice,
          date: new Date(),
        });

        const savedNalco = await newNalco.save();

        return {
          message: "Nalco updated (new price for today).",
          nalco: savedNalco,
        };
      } else {
        return {
          message: "Nalco price unchanged. No update needed.",
          nalco: existingEntry,
        };
      }
    }
  } catch (error) {
    console.error(error);
    return null;
  }
};



const runJob = async () => {

  const price = await downloadPdf();

  console.log('Price sending', price);

  if (price) {
    const res = await updateNalcoPrice(price);
    if (res) {
      console.log("Database updated successfully via service");
    } else {
      console.log("Failed to save new price");
    }
    
  }
};
// runJob();

cron.schedule("0 10 * * *", runJob, {
  timezone: "Asia/Kolkata",
});
console.log("Cron job scheduled");
