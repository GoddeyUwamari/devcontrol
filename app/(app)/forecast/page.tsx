'use client';

import { useState, useEffect, useMemo } from 'react';
import { forecastService } from '@/lib/services/forecast.service';
import { CostForecast, Scenario, ScenarioType } from '@/types/forecast.types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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
  Minus,
  RefreshCw,
  ChevronRight,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

// FIX 2 — strip markdown bold/italic markers before rendering
const stripMarkdown = (text: string) =>
  text.replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .trim();

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
    } catch (error: unknown) {
      console.error('Failed to load forecast:', error);
      toast.error('Failed to load forecast data');
    } finally {
      setIsLoading(false);
    }
  };

  const generateScenario = async (type: ScenarioType, params: Record<string, unknown>) => {
    try {
      toast.info('Generating scenario...', { icon: <Loader2 className="h-4 w-4 animate-spin" /> });
      const scenario = await forecastService.generateScenario(type, params);
      setScenarios((prev) => [...prev.filter((s) => s.type !== type), scenario]);
      setSelectedScenario(scenario);
      toast.success(`${scenario.name} scenario generated`);
    } catch (error: unknown) {
      console.error('Failed to generate scenario:', error);
      toast.error('Failed to generate scenario');
    }
  };

  // FIX 1 — chart data with daily → monthly normalization (* 30)
  const chartData = useMemo(() => {
    if (!forecast) return [];

    const combined: {
      date: string;
      fullDate: Date;
      historical: number | null;
      predicted: number | null;
      upper: number | null;
      lower: number | null;
    }[] = [];

    // Add historical data
    forecast.historicalData.forEach((p) => {
      combined.push({
        date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(p.date),
        historical: Math.round((p.value || 0) * 30),  // daily → monthly
        predicted: null,
        upper: null,
        lower: null,
      });
    });

    // Bridge point (last historical = first prediction)
    const lastHistorical = forecast.historicalData[forecast.historicalData.length - 1];
    const lastMonthly = Math.round((lastHistorical.value || 0) * 30);
    combined.push({
      date: new Date(lastHistorical.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: new Date(lastHistorical.date),
      historical: lastMonthly,
      predicted: lastMonthly,
      upper: null,
      lower: null,
    });

    // Add predictions
    const confidenceRange = (forecast.confidenceInterval.upper - forecast.confidenceInterval.lower) / 90;

    forecast.predictions.forEach((p) => {
      const monthly = Math.round((p.value || 0) * 30);  // daily → monthly
      combined.push({
        date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: new Date(p.date),
        historical: null,
        predicted: monthly,
        upper: Math.round(monthly + (confidenceRange * 30) / 2),
        lower: Math.round(monthly - (confidenceRange * 30) / 2),
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
    // FIX 6 — page wrapper padding 40px 56px 64px
    <div style={{ padding: '40px 56px 64px', maxWidth: '1320px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#F8FAFC', borderRadius: '8px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Brain className="h-5 w-5" style={{ color: '#64748B' }} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                Cost Forecasting
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                AI-powered predictions and scenario planning for your AWS costs
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#475569' }}>
              Updated {new Date(forecast.generatedAt).toLocaleString()}
            </span>
            <Button variant="outline" size="sm" onClick={loadForecast}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* FIX 4 — KPI cards with neutral #F8FAFC icon backgrounds */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* Next 30 Days */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Next 30 Days</p>
                <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                  ${forecast.predicted30Day.toLocaleString()}
                </p>
                <div className={`flex items-center gap-1 ${getTrendColor()}`}>
                  {getTrendIcon()}
                  <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>
                    {forecast.growthRate > 0 ? '+' : ''}
                    {forecast.growthRate.toFixed(1)}% growth
                  </span>
                </div>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Calendar className="w-4 h-4" style={{ color: '#64748B' }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Quarter */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Next Quarter</p>
                <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                  ${forecast.predictedQuarter.toLocaleString()}
                </p>
                <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0 }}>
                  ~${Math.round(forecast.predictedQuarter / 3).toLocaleString()}/month avg
                </p>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <BarChart3 className="w-4 h-4" style={{ color: '#64748B' }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Confidence */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Confidence</p>
                <p style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                  {forecast.confidence}%
                </p>
                <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0 }}>
                  ${forecast.confidenceInterval.lower.toLocaleString()} –{' '}
                  ${forecast.confidenceInterval.upper.toLocaleString()}
                </p>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Target className="w-4 h-4" style={{ color: '#64748B' }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Volatility */}
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Volatility</p>
                <p className={`text-3xl font-bold mt-1 ${getVolatilityColor()}`} style={{ letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                  {getVolatilityLabel()}
                </p>
                <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0 }}>
                  Score: {forecast.volatility.toFixed(0)}/100
                </p>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Zap className="w-4 h-4" style={{ color: '#64748B' }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FIX 3 — AI Summary card — white background, no gradient */}
      <div style={{ background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: '16px', padding: '32px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg" style={{ flexShrink: 0 }}>
            <Lightbulb className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 style={{ fontWeight: 600, color: '#0F172A', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
              AI Forecast Summary
              <span style={{ fontSize: '0.72rem', fontWeight: 600, background: '#F3E8FF', color: '#7C3AED', padding: '2px 10px', borderRadius: '100px' }}>
                {forecast.forecastMethod}
              </span>
            </h3>
            <p style={{ color: '#1E293B', lineHeight: 1.7, margin: 0, fontSize: '0.925rem' }}>{forecast.aiSummary}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
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
          <Card style={{ marginBottom: '24px' }}>
            <CardHeader>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <CardTitle>Cost Forecast</CardTitle>
                  <CardDescription>
                    90-day historical data with 90-day AI predictions · Values shown as monthly equivalent
                  </CardDescription>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#3B82F6' }}></div>
                    <span style={{ color: '#475569' }}>Historical</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#8B5CF6' }}></div>
                    <span style={{ color: '#475569' }}>Predicted</span>
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
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={{ stroke: '#E5E7EB' }}
                    interval="preserveStartEnd"
                  />
                  {/* FIX 1 — Y-axis domain: floor 0, 30% headroom */}
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={{ stroke: '#E5E7EB' }}
                    tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`}
                    domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.3)]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E2E8F0',
                      borderRadius: '10px',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                      padding: '10px 14px',
                    }}
                    formatter={(value: number | string | (number | string)[] | undefined, name: string | undefined) => {
                      if (value == null) return ['-', name ?? ''];
                      const display = typeof value === 'number' ? value.toLocaleString() : String(value);
                      const label = name === 'historical' ? 'Historical' : name === 'predicted' ? 'Predicted' : name ?? '';
                      return [`$${display}/mo`, label];
                    }}
                    labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#0F172A' }}
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

          {/* Risks & Recommendations — FIX 2: stripMarkdown applied */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Risks */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Potential Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '12px', listStyle: 'none', padding: 0, margin: 0 }}>
                  {forecast.aiRisks.map((risk, index) => (
                    <li
                      key={index}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px', background: '#FFF7ED', border: '1px solid #FFEDD5', borderRadius: '8px' }}
                    >
                      <ArrowUpRight className="w-4 h-4 text-orange-600 shrink-0" style={{ marginTop: '1px' }} />
                      <span style={{ fontSize: '0.875rem', color: '#1E293B', lineHeight: 1.6 }}>{stripMarkdown(risk)}</span>
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
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '12px', listStyle: 'none', padding: 0, margin: 0 }}>
                  {forecast.aiRecommendations.map((rec, index) => (
                    <li
                      key={index}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px', background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: '8px' }}
                    >
                      <ChevronRight className="w-4 h-4 text-blue-600 shrink-0" style={{ marginTop: '1px' }} />
                      <span style={{ fontSize: '0.875rem', color: '#1E293B', lineHeight: 1.6 }}>{stripMarkdown(rec)}</span>
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
          <Card style={{ marginBottom: '24px' }}>
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
            <Card style={{ marginBottom: '24px', border: '2px solid #E9D5FF', background: '#FAFAFA' }}>
              <CardHeader>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '24px' }}>
                  <div style={{ textAlign: 'center', padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>Baseline (30-day)</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                      ${selectedScenario.baselineCost.toLocaleString()}
                    </p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>Scenario (30-day)</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                      ${selectedScenario.scenarioCost.toLocaleString()}
                    </p>
                  </div>
                  <div style={{
                    textAlign: 'center', padding: '16px', borderRadius: '8px',
                    background: selectedScenario.costDelta > 0 ? '#FEF2F2' : '#F0FDF4',
                    border: `1px solid ${selectedScenario.costDelta > 0 ? '#FECACA' : '#BBF7D0'}`,
                  }}>
                    <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>Impact</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: selectedScenario.costDelta > 0 ? '#DC2626' : '#059669', margin: 0 }}>
                      {selectedScenario.costDelta > 0 ? '+' : ''}${selectedScenario.costDelta.toLocaleString()}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: selectedScenario.costDelta > 0 ? '#DC2626' : '#059669', margin: 0 }}>
                      {selectedScenario.costDelta > 0 ? '+' : ''}
                      {selectedScenario.costDeltaPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* AI Analysis */}
                <div style={{ padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #E2E8F0', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <Info className="w-5 h-5 text-blue-600 shrink-0" style={{ marginTop: '1px' }} />
                    <div>
                      <p style={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px', fontSize: '0.875rem' }}>AI Analysis</p>
                      <p style={{ color: '#475569', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>{selectedScenario.aiAnalysis}</p>
                    </div>
                  </div>
                </div>

                {/* Recommendations — FIX 2: stripMarkdown */}
                <div style={{ padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <p style={{ fontWeight: 600, color: '#0F172A', marginBottom: '12px', fontSize: '0.875rem' }}>Recommendations</p>
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px', listStyle: 'none', padding: 0, margin: 0 }}>
                    {selectedScenario.aiRecommendations.map((rec, index) => (
                      <li key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <ChevronRight className="w-4 h-4 text-purple-600 shrink-0" style={{ marginTop: '1px' }} />
                        <span style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.6 }}>{stripMarkdown(rec)}</span>
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
                        <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          Scenario
                        </th>
                        <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          Baseline
                        </th>
                        <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          Scenario Cost
                        </th>
                        <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          Impact
                        </th>
                        <th style={{ textAlign: 'right', padding: '12px 16px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario) => (
                        <tr
                          key={scenario.id}
                          style={{
                            borderBottom: '1px solid #F1F5F9',
                            cursor: 'pointer',
                            background: selectedScenario?.id === scenario.id ? '#FAF5FF' : 'transparent',
                          }}
                          onClick={() => setSelectedScenario(scenario)}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '0.875rem' }}>{scenario.name}</span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', color: '#475569', fontSize: '0.875rem' }}>
                            ${scenario.baselineCost.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600, color: '#0F172A', fontSize: '0.875rem' }}>
                            ${scenario.scenarioCost.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600, color: scenario.costDelta > 0 ? '#DC2626' : '#059669', fontSize: '0.875rem' }}>
                            {scenario.costDelta > 0 ? '+' : ''}${scenario.costDelta.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 16px', color: scenario.costDelta > 0 ? '#DC2626' : '#059669', fontSize: '0.875rem' }}>
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
