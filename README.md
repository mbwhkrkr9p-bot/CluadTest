# Stock Dashboard

A modern, interactive stock dashboard built with React, Vite, and Tailwind CSS. View detailed financial metrics, historical data, and key performance indicators for S&P 500 companies.

## Features

- 📊 Interactive charts with 10-year historical data
- 📈 Real-time stock metrics (P/E ratio, market cap, revenue, etc.)
- 🎯 Coefficient of Variation (CV) analysis for stability indicators
- 📱 Fully responsive design for all devices
- 🎨 Modern glassmorphism UI with gradient backgrounds
- 💡 Detailed metric explanations via info tooltips

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd CluadTest
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

## Technologies Used

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Icon library
- **PostCSS & Autoprefixer** - CSS processing

## Project Structure

```
CluadTest/
├── src/
│   ├── components/
│   │   └── StockDashboard.jsx
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
├── tailwind.config.js
├── vite.config.js
└── README.md
```

## Currently Available Stocks

- **AAPL** - Apple Inc.

More stocks can be added by extending the `sampleStockData` object in `StockDashboard.jsx`.

## License

MIT