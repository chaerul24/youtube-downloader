# 🎬 YouTube Downloader (MP4 & MP3)

High-performance YouTube downloader built with **Node.js + yt-dlp**.  
Supports MP4 (with audio), MP3 conversion, real-time progress tracking, and queue system for stability.

---

## ✨ Features

- 🎥 Download video **MP4 (with audio)**
- 🎧 Convert to **MP3 (best quality)**
- ⚡ Fast download (multi-fragment support)
- 📊 Real-time progress (progress, speed, ETA)
- 🧠 Smart merge (video + audio auto)
- 🔄 Queue system (anti overload)
- 🚫 Rate limiting (anti spam)
- 🖼️ Thumbnail & title preview
- 📦 Auto delete file after download

---

## 🛠️ Tech Stack

- Node.js (Express)
- yt-dlp
- ffmpeg
- Server-Sent Events (SSE)

---

## ⚙️ Installation

### 1. Clone repository
```bash
git clone https://github.com/chaerul24/youtube-downloader.git
cd youtube-downloader
node app.js
