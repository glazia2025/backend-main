const { Builder, By } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const pdfParse = require("pdf-parse");
const os = require("os");
const { cleanupStalePdfTempDirs } = require("./pdfBrowser");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const parsePdf = async (filePath) => {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const lines = data.text.split("\n").map(line => line.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("CH10269750268250265750") || lines[i].includes("CH10")) {
        const ch10Line = lines[i].match(/CH10(\d{6})(\d{6})(\d{6})/);
        if (ch10Line && ch10Line.length === 4) {
          const thirdPrice = Number(ch10Line[3]);
          console.log("CH10 Price for 178/203/229/254 mm:", thirdPrice);
          return parseFloat(thirdPrice);
        }
      }
    }

    console.warn("CH10 price line not found or parsing failed.");
    return null;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    return null;
  }
};

const downloadPdf = async () => {
  cleanupStalePdfTempDirs();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-user-data-'));

  const options = new chrome.Options()
    .addArguments("--headless=new")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments(`--user-data-dir=${userDataDir}`);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  try {
    await driver.get("https://nalcoindia.com/domestic/current-price/");
    const priceDivs = await driver.findElements(By.css(".price-div a"));

    console.log(priceDivs.length, "priceDivs found");
    if (priceDivs.length === 0) {
      throw new Error("No price links found on the page.");
    }

    let pdfUrl;
    for (let i = 0; i < priceDivs.length; ++i) {
      const temp = await priceDivs[i].getAttribute("href");
      console.log(`Link ${i + 1}:`, temp);
      if (temp && temp.toLowerCase().includes("billet")) {
        pdfUrl = temp;
        break;
      }
    }

    if (!pdfUrl) throw new Error("PDF URL not found.");

    console.log("PDF URL:", pdfUrl);

    const pdfPath = path.join(os.tmpdir(), `nalco_price_${Date.now()}.pdf`);
    try {
      const response = await axios.get(pdfUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(pdfPath, response.data);
      console.log("pdfPath", pdfPath);

      return await parsePdf(pdfPath);
    } finally {
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
        console.log("Temporary PDF file deleted");
      }
    }
  } catch (error) {
    console.error("Error in downloadPdf:", error);
  } finally {
    try {
      await driver.quit();
    } catch (error) {
      console.warn("Failed to quit Chrome driver:", error.message);
    }

    // Wait briefly to let Chrome release files
    await sleep(1000);

    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.log("Temporary Chrome profile deleted");
    } catch (err) {
      console.warn("Failed to clean Chrome profile:", err.message);
    }
  }
};

module.exports = {
  downloadPdf
};
