# GoMining Simulator

A comprehensive investment simulator and strategy tool for [GoMining](https://gomining.com) NFT miners.

**[Live Demo →](https://jaygauvin2002.github.io/gomining-simulator/)**

![GoMining Simulator Dashboard](screenshot.png)

## Features

- **Dashboard** - Real-time KPIs, progress tracking, reward calendar
- **Mining Simulator** - Calculate daily/monthly/annual rewards with exact GoMining formulas
- **BTC Scenarios** - Profit projections at different Bitcoin prices
- **Reinvestment Strategy Map** - BTC x GMT heatmap to find the optimal strategy
- **Strategy Comparison** - Buy NFT vs Upgrade vs Lock GMT
- **Multi-Scenario Simulation** - Interactive BTC & difficulty sliders with 12-month projections
- **Performance Tracking** - Actual vs projected gains comparison
- **Portfolio** - Investment transaction ledger with ROI tracking
- **Price Alerts** - Configurable BTC/GMT price notifications

## Chrome Extension

The included Chrome extension automatically syncs data from your GoMining account:

- Intercepts API calls on `app.gomining.com`
- Auto-syncs miner data, rewards, prices, and discounts
- Captures veGMT lock/staking rewards
- No manual copy-paste needed

### Install Extension (Developer Mode)

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder

## Getting Started

1. Open `index.html` in your browser (or visit the hosted version)
2. Install the Chrome extension
3. Visit `app.gomining.com` and navigate through your miner pages
4. The simulator auto-syncs your data

## Tech Stack

- Pure vanilla HTML/CSS/JS (single file, no framework)
- Chrome Extension (Manifest V3)
- PWA-ready (installable on desktop)
- CoinGecko & Mempool.space APIs for live prices

## Calculations

All mining calculations match GoMining's exact formulas:
- **C1 (Electricity)**: `kWh * 24 * W/TH / GMT_price / 1000 * (1 - discount)`
- **C2 (Service)**: `0.0089 / GMT_price * (1 - discount)`
- **Pool Reward**: Derived from GoMining API or mempool.space

## License

MIT
