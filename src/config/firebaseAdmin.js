const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const fs = require("node:fs");
const path = require("node:path");
const credentialsPath = path.join(__dirname, "glazia-61de6-firebase-adminsdk-fbsvc-13d680740f.json");
const localEnvironment = !process.env.NODE_ENV || ["development", "test"].includes(process.env.NODE_ENV);

if (!fs.existsSync(credentialsPath) && localEnvironment && !getApps().length) {
  console.warn("Firebase credentials missing: blogs are disabled for local development.");
  module.exports = null;
} else {
  if (!getApps().length) {
    initializeApp({ credential: cert(require(credentialsPath)) });
  }
  module.exports = getFirestore();
}
