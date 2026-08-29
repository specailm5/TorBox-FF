# TorBox Debrid & Cache Manager

A modern, high-performance browser extension (compatible with **Firefox, Chrome, Brave, Edge, and Opera**) that integrates with [TorBox.app](https://torbox.app). It detects torrents, magnet links, Usenet NZBs, and 300+ file hosters on web pages, checks TorBox cache status in real-time, and enables instant direct downloads with 1 click.

---

## ✨ Key Features

- **⚡ Instant Real-Time Cache Checking**:
  - Automatically scans web pages and checks cache status via TorBox API v1 with intelligent batching.
  - Supports **Magnet links**, **.torrent URLs**, **Usenet (.nzb)**, and **300+ File Hosters** (Rapidgator, 1fichier, Mega, Pixeldrain, DDownload, Mediafire, etc.).
  - **Deep Plaintext Scanning**: Detects raw magnet URIs and unlinked hoster URLs inside forum posts, `<pre>`, `<code>`, and text containers.

- **🚀 1-Click Direct Downloads**:
  - Cached files are downloaded directly via TorBox high-speed CDN through your native browser download manager (compatible with IDM, JDownloader, FDM).
  - Uncached links can be queued to your TorBox cloud with 1 click (`☁️ To TB`).

- **✨ Dark Glassmorphic Dashboard & Popup**:
  - **Scanner Tab**: Real-time link counts, live search filter, category chips, and **"⚡ Download All Cached"** / **"☁️ Add All to TorBox"** batch actions.
  - **Quick Debrid Tab**: Paste any Magnet link or Filehoster URL directly into the popup to instantly check cache and download.
  - **Cloud Activity Tab**: Live TorBox queue manager displaying active/completed downloads, real-time progress bars, speeds, and CDN download triggers.
  - **Account & Quota Pill**: Live view of your account plan tier (Pro / Essential / Free) and daily bandwidth quota usage.

- **🛸 Floating Quick-Action Dock**:
  - Non-intrusive bottom-right floating badge displaying detected links and real-time cache counts, with a slide-up drawer for instant 1-click downloads.

- **⚙️ Full-Featured Options Dashboard**:
  - Account API verification with plan tier and expiration details.
  - Granular scanning preferences (domain whitelist & blacklist rules, notifications, download manager routing).
  - **Searchable Hosters Explorer**: Interactive directory of all 300+ supported hosters and stream providers.

---

## 📦 Installation Guide

### Chromium-Based Browsers (Chrome, Brave, Edge, Opera, Vivaldi)
1. Open your browser and navigate to `chrome://extensions` (or `edge://extensions` / `brave://extensions`).
2. Turn on **Developer Mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left).
4. Select this project folder (`TorBox-FF`).

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` inside this project folder (`TorBox-FF`).

---

## 🔑 Initial Configuration

1. Click on the **TorBox** extension icon in your browser toolbar.
2. Click the **⚙️ Settings** icon in the header (or right-click extension icon > *Options*).
3. Paste your **TorBox API Key** (obtained from [torbox.app/settings](https://torbox.app/settings)).
4. Click **Save Key**. Your connected account profile (Plan tier, Bandwidth limit, Expiration) will immediately load and display.

*(Note: API keys are stored locally within extension storage and are never exposed to webpage scripts.)*


