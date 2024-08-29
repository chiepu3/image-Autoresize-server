import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import chokidar from "chokidar";
import axios from "axios";

const app = express();
const port = 8020;

app.use(cors());
app.use(express.json());

interface Config {
  resizeWidth: number;
  resizeHeight: number;
  enlargeSmallImages: boolean;
  watchFolder: string;
  resizedFolder: string;
  fillTransparentWithWhite: boolean;
  moveFromDownloads: boolean;
  downloadsFolderPattern: string;
}

let config: Config = {
  resizeWidth: 1280,
  resizeHeight: 720,
  enlargeSmallImages: false,
  watchFolder: "",
  resizedFolder: "",
  fillTransparentWithWhite: false,
  moveFromDownloads: false,
  downloadsFolderPattern: "",
};

// 設定を取得するエンドポイント
app.get("/config", (req, res) => {
  res.json(config);
});

// 設定を更新するエンドポイント
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };

  //ただし、Resize WidthとResize Heightは数値に変換する必要がある
  config.resizeWidth = parseInt(req.body.resizeWidth, 10);
  config.resizeHeight = parseInt(req.body.resizeHeight, 10);

  res.json({ message: "Configuration updated", config });

  //jsonファイルに設定を保存する
  fs.writeFileSync("config.json", JSON.stringify(config, null, 2));

  // 設定が変更されたら監視を再開する
  setupWatcher();
});

//index.ts

//起動時、設定ファイルを読み込む
if (fs.existsSync("config.json")) {
  config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
}

// 画像をリサイズする関数
async function resizeImage(filePath: string) {
  const fileName = path.basename(filePath);
  const outputPath = path.join(config.resizedFolder, fileName);

  try {
    let sharpInstance = sharp(filePath);

    if (
      config.fillTransparentWithWhite &&
      path.extname(filePath).toLowerCase() === ".png"
    ) {
      console.log("fillTransparentWithWhite");
      sharpInstance = sharpInstance.flatten({
        background: { r: 255, g: 255, b: 255 },
      });
    }

    const metadata = await sharpInstance.metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (
      !config.enlargeSmallImages &&
      (originalWidth <= config.resizeWidth ||
        originalHeight <= config.resizeHeight)
    ) {
      // 画像が目標サイズ以下の場合はコピーのみ。ただし、透過部分を白で埋めるオプションが有効な場合はリサイズする
      if (config.fillTransparentWithWhite) {
        await sharpInstance
          .resize(config.resizeWidth, config.resizeHeight, {
            fit: "inside",
            withoutEnlargement: !config.enlargeSmallImages,
          })
          .toFile(outputPath);
      }
    } else {
      await sharpInstance
        .resize(config.resizeWidth, config.resizeHeight, {
          fit: "inside",
          withoutEnlargement: !config.enlargeSmallImages,
        })
        .toFile(outputPath);
    }

    console.log(`Resized: ${fileName}`);
  } catch (error) {
    console.error(`Error resizing ${fileName}:`, error);
  }
}

// フォルダを監視する関数
let watcher: chokidar.FSWatcher;

function setupWatcher() {
  if (watcher) {
    watcher.close();
  }

  watcher = chokidar
    .watch(config.watchFolder, { ignored: /(^|[\/\\])\../ })
    .on("add", (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
        resizeImage(filePath);
      }
    });

  if (config.moveFromDownloads) {
    const downloadsPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      "Downloads"
    );
    chokidar
      .watch(downloadsPath, { ignored: /(^|[\/\\])\../ })
      .on("add", (filePath) => {
        const fileName = path.basename(filePath);
        if (fileName.match(config.downloadsFolderPattern)) {
          const newPath = path.join(config.watchFolder, fileName);
          fs.renameSync(filePath, newPath);
          console.log(`Moved: ${fileName} to watch folder`);
        }
      });
  }
}

// 画像をダウンロードするエンドポイント
app.post("/download-image", async (req, res) => {
  const { url, filename } = req.body;

  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    const outputPath = path.join(config.watchFolder, filename);
    fs.writeFileSync(outputPath, buffer);

    console.log(`Downloaded: ${filename}`);
    res.json({ message: "Image downloaded successfully" });
  } catch (error) {
    console.error(`Error downloading image:`, error);
    res.status(500).json({ error: "Failed to download image" });
  }
});

// クライアントから送信された画像を保存するエンドポイント
app.post("/save-image", (req, res) => {
  const { filename, imageData } = req.body;

  try {
    const buffer = Buffer.from(imageData, "base64");
    const outputPath = path.join(config.watchFolder, filename);
    fs.writeFileSync(outputPath, buffer);

    console.log(`Saved: ${filename}`);
    res.json({ message: "Image saved successfully" });
  } catch (error) {
    console.error(`Error saving image:`, error);
    res.status(500).json({ error: "Failed to save image" });
  }
});
app.post("/download", async (req, res) => {
  const { url } = req.body;
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    const fileName = generateFileName();
    const filePath = path.join(config.watchFolder, fileName);

    fs.writeFileSync(filePath, buffer);
    res.json({ success: true, message: "Image downloaded successfully" });
  } catch (error) {
    console.error("Error downloading image:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to download image" });
  }
});

app.post("/saveBase64", (req, res) => {
  const { base64data } = req.body;
  try {
    const base64Image = base64data.split(";base64,").pop();
    const imageBuffer = Buffer.from(base64Image, "base64");

    const fileName = generateFileName();
    const filePath = path.join(config.watchFolder, fileName);

    fs.writeFileSync(filePath, imageBuffer);
    res.json({ success: true, message: "Base64 image saved successfully" });
  } catch (error) {
    console.error("Error saving base64 image:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to save base64 image" });
  }
});

function generateFileName(): string {
  const date = new Date();
  const yymmdd =
    date.getFullYear().toString().slice(-2) +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    date.getDate().toString().padStart(2, "0");

  const files = fs.readdirSync(config.watchFolder);
  const existingNumbers = files
    .filter((file) => file.startsWith(yymmdd))
    .map((file) => parseInt(file.slice(-6)))
    .sort((a, b) => b - a);

  const nextNumber = (existingNumbers[0] || 0) + 1;
  return `${yymmdd}_${nextNumber.toString().padStart(6, "0")}.jpg`;
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  setupWatcher();
});
