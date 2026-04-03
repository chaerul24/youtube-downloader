module.exports = {
  apps: [
    {
      name: "ytb-downloader",
      script: "app.js",
      watch: false,
      instances: 1,
      autorestart: true,
    }
  ]
};
