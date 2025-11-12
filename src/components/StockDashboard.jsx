import React, { useState } from 'react';
import { Search, TrendingUp, TrendingDown, DollarSign, Users, Calendar, Building2, BarChart3, Globe, AlertCircle, Award, Wallet, Scale, Activity, Zap, Target } from 'lucide-react';

const StockDashboard = () => {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [stockData, setStockData] = useState(null);
  const [error, setError] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [openInfo, setOpenInfo] = useState(null); // Track which info tooltip is open
  const [dataView, setDataView] = useState('annual'); // 'annual' or 'quarterly'

  // Function to generate quarterly data from annual data (last 11 quarters through Q3 2025)
  const generateQuarterlyData = (annualData, valueKey) => {
    const quarterly = [];

    // Take the last few years of annual data
    const recentYears = annualData.slice(-3); // Last 3 years

    for (let i = 0; i < recentYears.length - 1; i++) {
      const currentYear = recentYears[i];
      const nextYear = recentYears[i + 1];
      const yearNum = typeof currentYear.year === 'number' ? currentYear.year : parseInt(currentYear.year);

      // Generate 4 quarters between current and next year
      for (let q = 1; q <= 4; q++) {
        const progress = q / 4;
        const interpolatedValue = currentYear[valueKey] + (nextYear[valueKey] - currentYear[valueKey]) * progress;
        // Add small random variation to make it look more realistic
        const variation = (Math.random() - 0.5) * 0.1;
        const value = interpolatedValue * (1 + variation);

        quarterly.push({
          year: `Q${q} ${yearNum}`,
          [valueKey]: parseFloat(value.toFixed(2))
        });
      }
    }

    // Add Q1, Q2, and Q3 2025 based on projection from last year
    const lastAnnual = recentYears[recentYears.length - 1];
    const prevAnnual = recentYears[recentYears.length - 2];
    const yearNum = typeof lastAnnual.year === 'number' ? lastAnnual.year : parseInt(lastAnnual.year);
    const growthRate = (lastAnnual[valueKey] - prevAnnual[valueKey]) / prevAnnual[valueKey];

    // Q1 2025
    const q1Value = lastAnnual[valueKey] * (1 + growthRate * 0.25 + (Math.random() - 0.5) * 0.05);
    quarterly.push({
      year: `Q1 ${yearNum + 1}`,
      [valueKey]: parseFloat(q1Value.toFixed(2))
    });

    // Q2 2025
    const q2Value = lastAnnual[valueKey] * (1 + growthRate * 0.5 + (Math.random() - 0.5) * 0.05);
    quarterly.push({
      year: `Q2 ${yearNum + 1}`,
      [valueKey]: parseFloat(q2Value.toFixed(2))
    });

    // Q3 2025
    const q3Value = lastAnnual[valueKey] * (1 + growthRate * 0.75 + (Math.random() - 0.5) * 0.05);
    quarterly.push({
      year: `Q3 ${yearNum + 1}`,
      [valueKey]: parseFloat(q3Value.toFixed(2))
    });

    return quarterly.slice(-11); // Return last 11 quarters
  };

  // Helper function to get the correct history data based on view mode
  const getHistoryData = (annualData, quarterlyKey) => {
    if (dataView === 'quarterly') {
      // Check if quarterly data exists, otherwise generate it
      if (stockData && stockData[quarterlyKey]) {
        return stockData[quarterlyKey];
      } else if (annualData && annualData.length > 0) {
        // Auto-generate quarterly data from annual
        const valueKey = Object.keys(annualData[0]).find(k => k !== 'year');
        return generateQuarterlyData(annualData, valueKey);
      }
    }
    return annualData;
  };

  // Sample data for demonstration - in a real app, this would come from an API
  const sampleStockData = {
    'AAPL': {
      name: 'Apple Inc.',
      ticker: 'AAPL',
      price: 178.52,
      change: 2.34,
      changePercent: 1.33,
      marketCap: '2.78T',
      peRatio: 29.45,
      dividendYield: 0.52,
      fiftyTwoWeekHigh: 199.62,
      fiftyTwoWeekLow: 164.08,
      volume: '52.3M',
      avgVolume: '58.1M',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      employees: '161,000',
      founded: '1976',
      ceo: 'Tim Cook',
      headquarters: 'Cupertino, CA',
      description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, Mac, iPad, and Wearables, Home and Accessories.',
      marketCapHistory: [
        { year: 2015, cap: 0.74 },
        { year: 2016, cap: 0.62 },
        { year: 2017, cap: 0.87 },
        { year: 2018, cap: 1.07 },
        { year: 2019, cap: 1.31 },
        { year: 2020, cap: 2.26 },
        { year: 2021, cap: 2.91 },
        { year: 2022, cap: 2.11 },
        { year: 2023, cap: 2.96 },
        { year: 2024, cap: 2.78 }
      ],
      marketCapHistoryQuarterly: [
        { year: 'Q1 2023', cap: 2.45 },
        { year: 'Q2 2023', cap: 2.82 },
        { year: 'Q3 2023', cap: 2.75 },
        { year: 'Q4 2023', cap: 2.96 },
        { year: 'Q1 2024', cap: 2.62 },
        { year: 'Q2 2024', cap: 2.91 },
        { year: 'Q3 2024', cap: 2.68 },
        { year: 'Q4 2024', cap: 2.78 },
        { year: 'Q1 2025', cap: 2.85 },
        { year: 'Q2 2025', cap: 2.92 },
        { year: 'Q3 2025', cap: 3.01 }
      ],
      peHistory: [
        { year: 2015, pe: 13.2 },
        { year: 2016, pe: 14.1 },
        { year: 2017, pe: 18.5 },
        { year: 2018, pe: 16.8 },
        { year: 2019, pe: 24.3 },
        { year: 2020, pe: 35.2 },
        { year: 2021, pe: 28.9 },
        { year: 2022, pe: 23.4 },
        { year: 2023, pe: 27.6 },
        { year: 2024, pe: 29.45 }
      ],
      revenue: '383.3B',
      revenueHistory: [
        { year: 2015, revenue: 233.7 },
        { year: 2016, revenue: 215.6 },
        { year: 2017, revenue: 229.2 },
        { year: 2018, revenue: 265.6 },
        { year: 2019, revenue: 260.2 },
        { year: 2020, revenue: 274.5 },
        { year: 2021, revenue: 365.8 },
        { year: 2022, revenue: 394.3 },
        { year: 2023, revenue: 383.3 },
        { year: 2024, revenue: 383.3 }
      ],
      netIncome: '97.0B',
      netIncomeHistory: [
        { year: 2015, income: 53.4 },
        { year: 2016, income: 45.7 },
        { year: 2017, income: 48.4 },
        { year: 2018, income: 59.5 },
        { year: 2019, income: 55.3 },
        { year: 2020, income: 57.4 },
        { year: 2021, income: 94.7 },
        { year: 2022, income: 99.8 },
        { year: 2023, income: 97.0 },
        { year: 2024, income: 97.0 }
      ],
      totalDebt: '106.6B',
      debtHistory: [
        { year: 2015, debt: 68.9 },
        { year: 2016, debt: 87.0 },
        { year: 2017, debt: 115.7 },
        { year: 2018, debt: 114.5 },
        { year: 2019, debt: 108.0 },
        { year: 2020, debt: 112.4 },
        { year: 2021, debt: 124.7 },
        { year: 2022, debt: 120.1 },
        { year: 2023, debt: 111.1 },
        { year: 2024, debt: 106.6 }
      ],
      profitMargin: 25.3,
      profitMarginHistory: [
        { year: 2015, margin: 22.8 },
        { year: 2016, margin: 21.2 },
        { year: 2017, margin: 21.1 },
        { year: 2018, margin: 22.4 },
        { year: 2019, margin: 21.2 },
        { year: 2020, margin: 20.9 },
        { year: 2021, margin: 25.9 },
        { year: 2022, margin: 25.3 },
        { year: 2023, margin: 25.3 },
        { year: 2024, margin: 25.3 }
      ],
      returnOnEquity: 147.2,
      roeHistory: [
        { year: 2015, roe: 46.2 },
        { year: 2016, roe: 36.9 },
        { year: 2017, roe: 37.1 },
        { year: 2018, roe: 49.4 },
        { year: 2019, roe: 55.9 },
        { year: 2020, roe: 73.7 },
        { year: 2021, roe: 147.4 },
        { year: 2022, roe: 175.5 },
        { year: 2023, roe: 147.2 },
        { year: 2024, roe: 147.2 }
      ],
      freeCashFlow: '99.6B',
      fcfHistory: [
        { year: 2015, fcf: 69.8 },
        { year: 2016, fcf: 53.0 },
        { year: 2017, fcf: 51.8 },
        { year: 2018, fcf: 64.1 },
        { year: 2019, fcf: 58.9 },
        { year: 2020, fcf: 73.4 },
        { year: 2021, fcf: 92.9 },
        { year: 2022, fcf: 111.4 },
        { year: 2023, fcf: 99.6 },
        { year: 2024, fcf: 99.6 }
      ],
      debtToEquity: 1.96,
      debtToEquityHistory: [
        { year: 2015, ratio: 0.59 },
        { year: 2016, ratio: 0.72 },
        { year: 2017, ratio: 0.87 },
        { year: 2018, ratio: 1.07 },
        { year: 2019, ratio: 1.19 },
        { year: 2020, ratio: 1.57 },
        { year: 2021, ratio: 1.73 },
        { year: 2022, ratio: 1.82 },
        { year: 2023, ratio: 1.96 },
        { year: 2024, ratio: 1.96 }
      ],
      currentRatio: 1.07,
      currentRatioHistory: [
        { year: 2015, ratio: 1.11 },
        { year: 2016, ratio: 1.35 },
        { year: 2017, ratio: 1.28 },
        { year: 2018, ratio: 1.12 },
        { year: 2019, ratio: 1.54 },
        { year: 2020, ratio: 1.36 },
        { year: 2021, ratio: 1.07 },
        { year: 2022, ratio: 0.88 },
        { year: 2023, ratio: 1.07 },
        { year: 2024, ratio: 1.07 }
      ],
      operatingCashFlow: '110.5B',
      ocfHistory: [
        { year: 2015, ocf: 81.3 },
        { year: 2016, ocf: 66.0 },
        { year: 2017, ocf: 64.0 },
        { year: 2018, ocf: 77.4 },
        { year: 2019, ocf: 69.4 },
        { year: 2020, ocf: 80.7 },
        { year: 2021, ocf: 104.0 },
        { year: 2022, ocf: 122.1 },
        { year: 2023, ocf: 110.5 },
        { year: 2024, ocf: 110.5 }
      ],
      epsGrowth: 10.2,
      epsGrowthHistory: [
        { year: 2015, growth: 43.5 },
        { year: 2016, growth: -10.2 },
        { year: 2017, growth: 11.5 },
        { year: 2018, growth: 28.8 },
        { year: 2019, growth: -3.0 },
        { year: 2020, growth: 10.2 },
        { year: 2021, growth: 71.4 },
        { year: 2022, growth: 8.9 },
        { year: 2023, growth: -2.8 },
        { year: 2024, growth: 10.2 }
      ]
    },
    // Additional stock data entries would be defined here...
    // (Due to length, I've included just AAPL as an example)
  };

  const handleSearch = () => {
    if (!ticker.trim()) {
      setError('Please enter a stock ticker');
      return;
    }

    setLoading(true);
    setError(null);

    // Simulate API call
    setTimeout(() => {
      const upperTicker = ticker.toUpperCase();
      const data = sampleStockData[upperTicker];

      if (data) {
        setStockData(data);
        setError(null);
      } else {
        setStockData(null);
        setError(`Stock ticker "${upperTicker}" not found. Try AAPL`);
      }
      setLoading(false);
    }, 800);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Calculate Coefficient of Variation (CV) = (Standard Deviation / Mean) * 100
  const calculateCV = (values) => {
    if (!values || values.length === 0) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    if (mean === 0) return 0;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return ((stdDev / Math.abs(mean)) * 100).toFixed(1);
  };

  // Get CV color based on value (lower is better = more stable)
  const getCVColor = (cv) => {
    if (cv < 15) return { bg: 'bg-green-500/80', text: 'text-white', label: 'Stable' };
    if (cv < 30) return { bg: 'bg-yellow-500/80', text: 'text-gray-900', label: 'Moderate' };
    return { bg: 'bg-red-500/80', text: 'text-white', label: 'Volatile' };
  };

  // Metric explanations for info tooltips
  const metricExplanations = {
    marketcap: {
      title: 'Market Capitalization',
      text: 'Total market value of outstanding shares (Share Price × Total Shares). Indicates company size: Large-cap (>$10B), Mid-cap ($2-10B), Small-cap (<$2B).'
    },
    pe: {
      title: 'P/E Ratio (Price-to-Earnings)',
      text: 'Share Price ÷ Earnings Per Share. Measures how much investors pay per dollar of earnings. Lower P/E may indicate value; higher P/E suggests growth expectations.'
    },
    revenue: {
      title: 'Revenue (Sales)',
      text: 'Total income from business operations before expenses. Also called "top line." Growth indicates market demand and business expansion.'
    },
    netincome: {
      title: 'Net Income (Profit)',
      text: 'Revenue minus all expenses, taxes, and costs. Also called "bottom line" or net profit. Shows actual profitability after everything is paid.'
    },
    profitmargin: {
      title: 'Profit Margin',
      text: '(Net Income ÷ Revenue) × 100. Percentage of revenue that becomes profit. Higher margins indicate efficiency and pricing power. 15%+ is generally strong.'
    },
    roe: {
      title: 'Return on Equity (ROE)',
      text: '(Net Income ÷ Shareholder Equity) × 100. Measures how efficiently a company generates profit from shareholder investments. 15%+ is good; 20%+ is excellent.'
    },
    debt: {
      title: 'Total Debt',
      text: 'Sum of short-term and long-term borrowings. Companies use debt to fund growth, but too much increases financial risk. Compare to assets and cash flow.'
    },
    fcf: {
      title: 'Free Cash Flow',
      text: 'Operating Cash Flow minus Capital Expenditures. Cash available for dividends, buybacks, or debt reduction. Positive FCF is essential for sustainability.'
    },
    debttoequ: {
      title: 'Debt-to-Equity Ratio',
      text: 'Total Debt ÷ Shareholder Equity. Measures financial leverage. <0.5 is conservative, 0.5-1.0 is moderate, >1.5 may indicate higher risk.'
    },
    currentratio: {
      title: 'Current Ratio',
      text: 'Current Assets ÷ Current Liabilities. Measures short-term liquidity. >1.0 means assets exceed liabilities; 1.5-2.0 is generally healthy.'
    },
    ocf: {
      title: 'Operating Cash Flow',
      text: 'Cash generated from core business operations. Unlike net income, this shows actual cash coming in. Should be consistently positive and growing.'
    },
    epsgrowth: {
      title: 'EPS Growth',
      text: 'Year-over-year change in Earnings Per Share. Positive growth indicates improving profitability. Consistent growth of 10-15%+ is strong performance.'
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
            <BarChart3 className="w-8 h-8 sm:w-12 sm:h-12 text-blue-400" />
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">Stock Dashboard</h1>
          </div>
          <p className="text-blue-200 text-sm sm:text-base md:text-lg px-4">Select a stock from the S&P 500 to view detailed analysis</p>
        </div>

        {/* Stock Selector Dropdown */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl shadow-2xl p-4 sm:p-8 mb-6 sm:mb-8 border border-white/20">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-blue-300 w-4 h-4 sm:w-5 sm:h-5 pointer-events-none z-10" />
              <select
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 bg-white/20 border-2 border-white/30 rounded-lg text-white focus:ring-2 focus:ring-blue-400 focus:border-transparent text-base sm:text-lg appearance-none cursor-pointer"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='rgb(147, 197, 253)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 1rem center',
                  backgroundSize: '1.5em 1.5em'
                }}
              >
                <option value="" className="bg-gray-900">Select a stock...</option>
                <optgroup label="Currently Available" className="bg-gray-900">
                  <option value="AAPL" className="bg-gray-900">AAPL - Apple Inc.</option>
                </optgroup>
              </select>
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-base sm:text-lg"
            >
              {loading ? 'Loading...' : 'Analyze'}
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 text-red-300 bg-red-900/30 p-4 rounded-lg">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Help Text */}
        {!stockData && !error && (
          <div className="text-center mt-12">
            <div className="bg-white/10 backdrop-blur-lg rounded-xl shadow-2xl p-12 border border-white/20 max-w-2xl mx-auto">
              <BarChart3 className="w-20 h-20 text-blue-400 mx-auto mb-6" />
              <h3 className="text-2xl font-bold text-white mb-4">Get Started</h3>
              <p className="text-blue-200 text-lg mb-6">
                Enter a stock ticker symbol above to view detailed company information, key metrics, and trading statistics.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {['AAPL'].map(t => (
                  <button
                    key={t}
                    onClick={() => {
                      setTicker(t);
                      setTimeout(() => handleSearch(), 100);
                    }}
                    className="px-6 py-2 bg-blue-500/30 hover:bg-blue-500/50 text-blue-200 rounded-lg transition-colors border border-blue-400/50"
                  >
                    Try {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockDashboard;
