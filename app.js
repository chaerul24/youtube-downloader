const express = require("express");
const cors = require("cors");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

/* ================= CONFIG ================= */

const CONFIG_PATH = "/home/serverhome/.config/yt-dlp/config";
const MAX_CONCURRENT = 2;
let activeJobs = 0;
const queue = [];
const cache = {};
const progressMap = {};
/* ================= RATE LIMIT ================= */

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 20
}));

/* ================= HELPER ================= */

const cleanUrl = (url) => {
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get("v");
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return url;
  } catch {
    return url;
  }
};

const now = () => Date.now();

/* ================= QUEUE ================= */

const runQueue = () => {
  if (activeJobs >= MAX_CONCURRENT || queue.length === 0) return;

  const job = queue.shift();
  activeJobs++;

  job(() => {
    activeJobs--;
    runQueue();
  });
};

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

/* ================= FORMATS ================= */

app.get("/formats", (req, res) => {
  const totalStart = now();

  try {
    let url = req.query.url;
    if (!url) return res.status(400).json({ error: "URL is required" });

    url = cleanUrl(url);

    if (cache[url]) {
      console.log("CACHE HIT");
      return res.json(cache[url]);
    }

    if (queue.length > 20) {
      return res.status(429).json({ error: "Server busy" });
    }

    queue.push((done) => {
      const yt = spawn("yt-dlp", [
        "--config-location", CONFIG_PATH,
        "-j",
        "--no-playlist",
        "--no-warnings",
        url
      ]);

      let output = "";

      yt.stdout.on("data", d => output += d.toString());

      yt.on("close", (code) => {
        done();

        if (code !== 0) {
          return res.status(500).json({ error: "yt-dlp failed" });
        }

        try {
          const data = JSON.parse(output);

          let formats = [];

          // 🎥 MP4
          data.formats
            .filter(f => f.ext === "mp4" && f.height && f.vcodec !== "none")
            .forEach(f => {
              formats.push({
                type: "video",
                quality: f.height + "p",
                format: f.format_id,
                ext: "mp4"
              });
            });

          // 🎧 MP3
          formats.push({
            type: "audio",
            quality: "mp3",
            format: "bestaudio",
            ext: "mp3"
          });

          // remove duplicate
          const seen = new Set();
          formats = formats.filter(f => {
            if (f.type === "audio") return true;
            if (seen.has(f.quality)) return false;
            seen.add(f.quality);
            return true;
          });

          formats.sort((a, b) => {
            if (a.type === "audio") return 1;
            if (b.type === "audio") return -1;
            return parseInt(b.quality) - parseInt(a.quality);
          });

          const result = {
            title: data.title,
            thumbnail: data.thumbnail,
            formats
          };

          cache[url] = result;

          console.log("TOTAL:", now() - totalStart, "ms");

          res.json(result);

        } catch {
          res.status(500).json({ error: "Parse failed" });
        }
      });

      yt.on("error", () => {
        done();
        res.status(500).json({ error: "Spawn error" });
      });

    });

    runQueue();

  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});
app.get("/progress", (req, res) => {
  const id = req.query.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let lastProgress = 0;

  const interval = setInterval(() => {
    let data = progressMap[id];

    if (!data) {
      data = {
        progress: lastProgress,
        status: "Preparing..."
      };
    }

    // 🔥 smooth progress (biar ga lompat)
    if (data.progress > lastProgress) {
      lastProgress = data.progress;
    } else {
      lastProgress = Math.min(lastProgress + 0.5, 99);
    }

    res.write(`data: ${JSON.stringify({
      progress: lastProgress.toFixed(1),
      status: data.status || "Downloading...",
      speed: data.speed || "",
      eta: data.eta || ""
    })}\n\n`);

    if (data.done) {
      res.write(`data: ${JSON.stringify({
        progress: 100,
        status: "Complete ✅"
      })}\n\n`);

      clearInterval(interval);
      res.end();
    }

  }, 300);

  req.on("close", () => {
    clearInterval(interval);
  });
});
/* ================= DOWNLOAD ================= */

app.get("/download", (req, res) => {
  try {
    let { url, format } = req.query;
    const id = req.query.id || Date.now().toString();

    progressMap[id] = { progress: 0 };

    if (!url) return res.status(400).json({ error: "URL is required" });

    url = cleanUrl(url);

    if (!fs.existsSync("downloads")) {
      fs.mkdirSync("downloads");
    }

    let args = [
      "--config-location", CONFIG_PATH,
      "-f", format === "bestaudio"
        ? "bestaudio"
        : `${format}+bestaudio[ext=m4a]/best`,
      "--merge-output-format", "mp4",
      "--remux-video", "mp4",
      "--concurrent-fragments", "4",
      "--newline",
      "--print", "after_move:filepath",
      "-o", "downloads/%(title)s.%(ext)s",
      url
    ];

    if (format === "bestaudio") {
      args.push(
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0"
      );
    }

    console.log("DOWNLOAD START");

    const yt = spawn("yt-dlp", args);

    let filename = "";

    // 🔥 ambil file path
    yt.stdout.on("data", (data) => {
      const text = data.toString().trim();

      if (text.includes("downloads/")) {
        filename = text;
        console.log("FILE:", filename);
      }
    });

    // 🔥 progress
    yt.stderr.on("data", (data) => {
      const msg = data.toString();

      const percentMatch = msg.match(/(\d+\.\d+)%/);
      const speedMatch = msg.match(/at\s+([^\s]+)/);
      const etaMatch = msg.match(/ETA\s+([^\s]+)/);

      if (percentMatch) {
        progressMap[id] = {
          ...progressMap[id],
          progress: parseFloat(percentMatch[1]),
          status: "Downloading...",
          speed: speedMatch ? speedMatch[1] : "",
          eta: etaMatch ? etaMatch[1] : ""
        };
      }

      if (match) {
        const percent = parseFloat(match[1]);

        progressMap[id] = {
          ...progressMap[id],
          progress: percent
        };

        console.log("PROGRESS:", percent);
      }
    });

    yt.on("close", (code) => {
      console.log("DONE:", code);

      progressMap[id] = {
        ...progressMap[id],
        progress: 100,
        done: true
      };

      setTimeout(() => {
        if (!filename || !fs.existsSync(filename)) {
          return res.status(500).json({ error: "File not found" });
        }

        res.download(filename, (err) => {
          if (err) console.error(err);
          fs.unlink(filename, () => { });
        });

      }, 500);
    });

    yt.on("error", () => {
      res.status(500).json({ error: "Download failed" });
    });

  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});

/* ================= SERVER ================= */

const PORT = 8077;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server jalan di http://0.0.0.0:${PORT}`);
});