'use client';

import { useState, useEffect, useMemo } from 'react';
import { forecastService } from '@/lib/services/forecast.service';
import { CostForecast, Scenario, ScenarioType } from '@/types/forecast.types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  AlertTriangle,
  Lightbulb,
  Zap,
  BarChart3,
  Loader2,
  Brain,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
  ChevronRight,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

export default function ForecastPage() {
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'forecast' | 'scenarios'>('forecast');

  // Custom scenario form
  const [customParams, setCustomParams] = useState({
    trafficMultiplier: 2,
    newServiceCost: 1000,
    optimizationSavings: 500,
    customAdjustment: 10,
  });

  useEffect(() => {
    loadForecast();
  }, []);

  const loadForecast = async () => {
    setIsLoading(true);
    try {
      const data = await forecastService.getForecast('90d');
      setForecast(data);
    } catch (error: any) {
      console.error('Failed to load forecast:', error);
      toast.error('Failed to load forecast data');
    } finally {
      setIsLoading(false);
    }
  };

  const generateScenario = async (type: ScenarioType, params: any) => {
    try {
      toast.info('Generating scenario...', { icon: <Loader2 className="h-4 w-4 animate-spin" /> });
      const scenario = await forecastService.generateScenario(type, params);
      setScenarios((prev) => [...prev.filter((s) => s.type !== type), scenario]);
      setSelectedScenario(scenario);
      toast.success(`${scenario.name} scenario generated`);
    } catch (error: any) {
      console.error('Failed to generate scenario:', error);
      toast.error('Failed to generate scenario');
    }
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!forecast) return [];

    const combined: any[] = [];

    // Add historical data
    forecast.historicalData.forEach((p) => {
      combined.push({
        date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(p.date),
        historical: p.value,
        predicted: null,
        upper: null,
        lower: null,
      });
    });

    // Add a bridge point (last historical = first prediction)
    const lastHistorical = forecast.historicalData[forecast.historicalData.length - 1];
    combined.push({
      date: new Date(lastHistorical.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      fullDate: new Date(lastHistorical.date),
      historical: lastHistorical.value,
      predicted: lastHistorical.value,
      upper: null,
      lower: null,
    });

    // Add predictions
    const avgPrediction = forecast.predictions.reduce((sum, p) => sum + p.value, 0) / forecast.predictions.length;
    const confidenceRange = (forecast.confidenceInterval.upper - forecast.confidenceInterval.lower) / 90;

    forecast.predictions.forEach((p) => {
      combined.push({
        date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(p.date),
        historical: null,
        predicted: p.value,
        upper: p.value + confidenceRange / 2,
        lower: p.value - confidenceRange / 2,
      });
    });

    return combined;
  }, [forecast]);

  const getTrendIcon = () => {
    if (!forecast) return null;
    if (forecast.trend === 'increasing')
      return <TrendingUp className="w-5 h-5 text-red-600" />;
    if (forecast.trend === 'decreasing')
      return <TrendingDown className="w-5 h-5 text-green-600" />;
    return <Minus className="w-5 h-5 text-gray-600" />;
  };

  const getTrendColor = () => {
    if (!forecast) return 'text-gray-600';
    if (forecast.trend === 'increasing') return 'text-red-600';
    if (forecast.trend === 'decreasing') return 'text-green-600';
    return 'text-gray-600';
  };

  const getVolatilityLabel = () => {
    if (!forecast) return 'Unknown';
    if (forecast.volatility < 30) return 'Low';
    if (forecast.volatility < 60) return 'Medium';
    return 'High';
  };

  const getVolatilityColor = () => {
    if (!forecast) return 'text-gray-600';
    if (forecast.volatility < 30) return 'text-green-600';
    if (forecast.volatility < 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-200 border-t-purple-600 mx-auto mb-4"></div>
            <Brain className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-purple-600" />
          </div>
          <p className="text-gray-600 mt-4">Generating AI-powered forecast...</p>
          <p className="text-sm text-gray-400 mt-1">Analyzing 90 days of cost data</p>
        </div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Unable to Load Forecast</h3>
          <p className="text-gray-600 mb-4">There was an error loading the forecast data.</p>
          <Button onClick={loadForecast}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Cost Forecasting</h1>
              <p className="text-gray-600">
                AI-powered predictions and scenario planning for your AWS costs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              Updated {new Date(forecast.generatedAt).toLocaleString()}
            </span>
            <Button variant="outline" size="sm" onClick={loadForecast}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Next 30 Days</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  ${forecast.predicted30Day.toLocaleString()}
                </p>
                <div className={`flex items-center gap-1 mt-2 ${getTrendColor()}`}>
                  {getTrendIcon()}
                  <span className="text-sm font-medium">
                    {forecast.growthRate > 0 ? '+' : ''}
                    {forecast.growthRate.toFixed(1)}% growth
                  </span>
                </div>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Next Quarter</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  ${forecast.predictedQuarter.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  ~${Math.round(forecast.predictedQuarter / 3).toLocaleString()}/month avg
                </p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Confidence</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{forecast.confidence}%</p>
                <p className="text-xs text-gray-500 mt-2">
                  ${forecast.confidenceInterval.lower.toLocaleString()} -{' '}
                  ${forecast.confidenceInterval.upper.toLocaleString()}
                </p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <Target className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Volatility</p>
                <p className={`text-3xl font-bold mt-1 ${getVolatilityColor()}`}>
                  {getVolatilityLabel()}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Score: {forecast.volatility.toFixed(0)}/100
                </p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <Zap className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Summary */}
      <Card className="mb-6 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shrink-0">
              <Lightbulb className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                AI Forecast Summary
                <span className="text-xs font-normal bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  {forecast.forecastMethod}
                </span>
              </h3>
              <p className="text-gray-700 leading-relaxed">{forecast.aiSummary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={activeTab === 'forecast' ? 'default' : 'outline'}
          onClick={() => setActiveTab('forecast')}
          className="gap-2"
        >
          <TrendingUp className="w-4 h-4" />
          Forecast Chart
        </Button>
        <Button
          variant={activeTab === 'scenarios' ? 'default' : 'outline'}
          onClick={() => setActiveTab('scenarios')}
          className="gap-2"
        >
          <Zap className="w-4 h-4" />
          What-If Scenarios
        </Button>
      </div>

      {activeTab === 'forecast' && (
        <>
          {/* Forecast Chart */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Cost Forecast</CardTitle>
                  <CardDescription>
                    90-day historical data with 90-day AI predictions
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span className="text-gray-600">Historical</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    <span className="text-gray-600">Predicted</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-gray-300"></div>
                    <span className="text-gray-600">Confidence Band</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient id="colorHistorical" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorConfidence" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#E5E7EB" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#E5E7EB" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    tickLine={{ stroke: '#E5E7EB' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    tickLine={{ stroke: '#E5E7EB' }}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    formatter={(value: any, name: string) => [
                      value ? `$${value.toFixed(2)}` : '-',
                      name === 'historical'
                        ? 'Historical'
                        : name === 'predicted'
                        ? 'Predicted'
                        : name,
                    ]}
                    labelStyle={{ fontWeight: 'bold', marginBottom: '4px' }}
                  />

                  {/* Confidence band */}
                  <Area
                    type="monotone"
                    dataKey="upper"
                    stroke="none"
                    fill="url(#colorConfidence)"
                    fillOpacity={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="lower"
                    stroke="none"
                    fill="white"
                    fillOpacity={1}
                  />

                  {/* Historical area */}
                  <Area
                    type="monotone"
                    dataKey="historical"
                    stroke="#3B82F6"
                    fill="url(#colorHistorical)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#3B82F6' }}
                  />

                  {/* Predicted area */}
                  <Area
                    type="monotone"
                    dataKey="predicted"
                    stroke="#8B5CF6"
                    fill="url(#colorPredicted)"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 4, fill: '#8B5CF6' }}
                  />

                  {/* Today reference line */}
                  <ReferenceLine
                    x={chartData[forecast.historicalData.length]?.date}
                    stroke="#EF4444"
                    strokeDasharray="3 3"
                    strokeWidth={2}
                    label={{
                      value: 'Today',
                      position: 'top',
                      fill: '#EF4444',
                      fontSize: 12,
                      fontWeight: 'bold',
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Risks & Recommendations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Risks */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Potential Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {forecast.aiRisks.map((risk, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg"
                    >
                      <ArrowUpRight className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                      <span className="text-gray-700 text-sm">{risk}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-blue-600" />
                  Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {forecast.aiRecommendations.map((rec, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg"
                    >
                      <ChevronRight className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                      <span className="text-gray-700 text-sm">{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {activeTab === 'scenarios' && (
        <>
          {/* Scenario Planning */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>What-If Scenarios</CardTitle>
              <CardDescription>
                Explore how different scenarios would impact your AWS costs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Traffic 2x */}
                <div
                  onClick={() =>
                    generateScenario('traffic_2x', {
                      trafficMultiplier: customParams.trafficMultiplier,
                    })
                  }
                  className="p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-5 h-5 text-blue-600 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-gray-900">Traffic Increase</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    What if traffic increases?
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={customParams.trafficMultiplier}
                      onChange={(e) =>
                        setCustomParams({ ...customParams, trafficMultiplier: Number(e.target.value) })
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 h-8 text-sm"
                      min={1}
                      max={10}
                    />
                    <span className="text-sm text-gray-500">x multiplier</span>
                  </div>
                </div>

                {/* Traffic Half */}
                <div
                  onClick={() => generateScenario('traffic_half', {})}
                  className="p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-yellow-400 hover:bg-yellow-50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="w-5 h-5 text-yellow-600 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-gray-900">Traffic Decrease</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    What if traffic drops 50%?
                  </p>
                  <span className="text-xs text-gray-400">Simulates reduced usage</span>
                </div>

                {/* New Service */}
                <div
                  onClick={() =>
                    generateScenario('new_service', { newServiceCost: customParams.newServiceCost })
                  }
                  className="p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-5 h-5 text-purple-600 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-gray-900">New Service</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">Add a new service</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">$</span>
                    <Input
                      type="number"
                      value={customParams.newServiceCost}
                      onChange={(e) =>
                        setCustomParams({ ...customParams, newServiceCost: Number(e.target.value) })
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-20 h-8 text-sm"
                      min={100}
                      step={100}
                    />
                    <span className="text-sm text-gray-500">/mo</span>
                  </div>
                </div>

                {/* Optimization */}
                <div
                  onClick={() =>
                    generateScenario('optimization', {
                      optimizationSavings: customParams.optimizationSavings,
                    })
                  }
                  className="p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-green-400 hover:bg-green-50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-5 h-5 text-green-600 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-gray-900">Optimization</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">Apply cost savings</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">-$</span>
                    <Input
                      type="number"
                      value={customParams.optimizationSavings}
                      onChange={(e) =>
                        setCustomParams({
                          ...customParams,
                          optimizationSavings: Number(e.target.value),
                        })
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-20 h-8 text-sm"
                      min={100}
                      step={100}
                    />
                    <span className="text-sm text-gray-500">/mo</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Selected Scenario Result */}
          {selectedScenario && (
            <Card className="mb-6 border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-600" />
                      {selectedScenario.name}
                    </CardTitle>
                    <CardDescription>{selectedScenario.description}</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedScenario(null)}
                  >
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Cost Comparison */}
                <div className="grid grid-cols-3 gap-6 mb-6">
                  <div className="text-center p-4 bg-white rounded-lg border">
                    <p className="text-sm text-gray-600 mb-1">Baseline (30-day)</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ${selectedScenario.baselineCost.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center p-4 bg-white rounded-lg border">
                    <p className="text-sm text-gray-600 mb-1">Scenario (30-day)</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ${selectedScenario.scenarioCost.toLocaleString()}
                    </p>
                  </div>
                  <div
                    className={`text-center p-4 rounded-lg border ${
                      selectedScenario.costDelta > 0
                        ? 'bg-red-50 border-red-200'
                        : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <p className="text-sm text-gray-600 mb-1">Impact</p>
                    <p
                      className={`text-2xl font-bold ${
                        selectedScenario.costDelta > 0 ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {selectedScenario.costDelta > 0 ? '+' : ''}$
                      {selectedScenario.costDelta.toLocaleString()}
                    </p>
                    <p
                      className={`text-sm ${
                        selectedScenario.costDelta > 0 ? 'text-red-500' : 'text-green-500'
                      }`}
                    >
                      {selectedScenario.costDelta > 0 ? '+' : ''}
                      {selectedScenario.costDeltaPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* AI Analysis */}
                <div className="p-4 bg-white rounded-lg border mb-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900 mb-1">AI Analysis</p>
                      <p className="text-gray-700 text-sm">{selectedScenario.aiAnalysis}</p>
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="p-4 bg-white rounded-lg border">
                  <p className="font-medium text-gray-900 mb-3">Recommendations</p>
                  <ul className="space-y-2">
                    {selectedScenario.aiRecommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <ChevronRight className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-gray-700">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scenario History */}
          {scenarios.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Generated Scenarios</CardTitle>
                <CardDescription>Compare different scenarios side by side</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">
                          Scenario
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">
                          Baseline
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">
                          Scenario Cost
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">
                          Impact
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario) => (
                        <tr
                          key={scenario.id}
                          className={`border-b hover:bg-gray-50 cursor-pointer ${
                            selectedScenario?.id === scenario.id ? 'bg-purple-50' : ''
                          }`}
                          onClick={() => setSelectedScenario(scenario)}
                        >
                          <td className="py-3 px-4">
                            <span className="font-medium text-gray-900">{scenario.name}</span>
                          </td>
                          <td className="text-right py-3 px-4 text-gray-600">
                            ${scenario.baselineCost.toLocaleString()}
                          </td>
                          <td className="text-right py-3 px-4 font-medium text-gray-900">
                            ${scenario.scenarioCost.toLocaleString()}
                          </td>
                          <td
                            className={`text-right py-3 px-4 font-medium ${
                              scenario.costDelta > 0 ? 'text-red-600' : 'text-green-600'
                            }`}
                          >
                            {scenario.costDelta > 0 ? '+' : ''}$
                            {scenario.costDelta.toLocaleString()}
                          </td>
                          <td
                            className={`text-right py-3 px-4 ${
                              scenario.costDelta > 0 ? 'text-red-600' : 'text-green-600'
                            }`}
                          >
                            {scenario.costDelta > 0 ? '+' : ''}
                            {scenario.costDeltaPercent.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
