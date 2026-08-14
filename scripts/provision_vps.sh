#!/usr/bin/env bash
# Provision a small Ubuntu VPS to run the job-hunt scheduler.
# Run as root or with sudo on the VM after creating it (cloud provider UI).

set -euo pipefail

# Variables - adjust as needed
REPO_URL="https://github.com/yourname/devops-sre-job-hunt.git" # replace or use scp/git clone later
APP_DIR="/opt/devops-sre-job-hunt"
NODE_VERSION="18"

# Update & install
apt update
apt install -y curl git build-essential

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

# Create app dir and clone (or pull)
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# Install dependencies (puppeteer optional but required for LinkedIn adapter)
npm install --no-audit --no-fund
# Puppeteer may download Chromium; ensure /usr/bin/chromium or libgbm installed
apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxss1 libx11-xcb1 libxcomposite1 libxrandr2 libgtk-3-0 libgbm-dev

# Create generated and data dirs
mkdir -p resume/generated data applications

# Create systemd unit
mkdir -p /etc/systemd/system
cat > /etc/systemd/system/devops-scheduler.service <<'EOF'
[Unit]
Description=Devops Job Hunt Scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/scripts/scheduler.mjs --intervalMinutes 15 --linkedinQuery "site reliability engineer" --linkedinLocation "Bengaluru" --notify
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable devops-scheduler.service
systemctl start devops-scheduler.service

echo "Provisioning complete. Service started: devops-scheduler.service"
