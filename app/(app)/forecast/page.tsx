'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { forecastService } from '@/lib/services/forecast.service';
import { CostForecast, Scenario, ScenarioType } from '@/types/forecast.types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ComposedChart,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, AlertTriangle, Lightbulb,
  Zap, Loader2, Brain, Minus, RefreshCw, ChevronRight, Info, Lock,
} from 'lucide-react';
import { usePlan } from '@/lib/hooks/use-plan';
import { toast } from 'sonner';
import { TREND_TOTALS_NOTE } from '@/lib/cost-trend-basis';
import { cn } from '@/lib/utils';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { CHART_TICK, CHART_TOOLTIP } from '@/lib/chart-theme';

const stripMarkdown = (text: string) =>
  text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();

export default function ForecastPage() {
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'forecast' | 'scenarios'>('forecast');
  const router = useRouter();

  const [customParams, setCustomParams] = useState({
    trafficMultiplier: 2,
    newServiceCost: 1000,
    optimizationSavings: 500,
    customAdjustment: 10,
  });

  useEffect(() => { loadForecast(); }, []);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setChartWidth(width);
    });
    observer.observe(chartContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const loadForecast = async () => {
    setIsLoading(true);
    try {
      const data = await forecastService.getForecast('90d');
      setForecast(data);
    } catch (error: unknown) {
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
      toast.error('Failed to generate scenario');
    }
  };

  const chartData = useMemo(() => {
    if (!forecast) return [];
    const combined: { date: string; fullDate: Date; historical: number | null; predicted: number | null; upper: number | null; lower: number | null }[] = [];

    forecast.historicalData.forEach((p) => {
      combined.push({ date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), fullDate: new Date(p.date), historical: Math.round((p.value || 0) * 30), predicted: null, upper: null, lower: null });
    });

    const lastHistorical = forecast.historicalData[forecast.historicalData.length - 1];
    const lastMonthly = Math.round((lastHistorical.value || 0) * 30);
    combined.push({ date: new Date(lastHistorical.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), fullDate: new Date(lastHistorical.date), historical: lastMonthly, predicted: lastMonthly, upper: null, lower: null });

    const isDemo = forecast.organizationId === 'demo';
    const confidenceRange = isDemo ? 0 : (forecast.confidenceInterval.upper - forecast.confidenceInterval.lower) / 90;

    forecast.predictions.forEach((p, i) => {
      const monthly = Math.round((p.value || 0) * 30);
      const bandOffset = isDemo ? (12 + (i % 4)) : (confidenceRange * 30) / 2;
      combined.push({ date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), fullDate: new Date(p.date), historical: null, predicted: monthly, upper: Math.round(monthly + bandOffset), lower: Math.round(monthly - bandOffset) });
    });

    return combined;
  }, [forecast]);

  const getTrendIcon = () => {
    if (!forecast) return null;
    if (forecast.trend === 'increasing') return <TrendingUp className="w-3.5 h-3.5 text-ink-danger" />;
    if (forecast.trend === 'decreasing') return <TrendingDown className="w-3.5 h-3.5 text-ink-success" />;
    return <Minus className="w-3.5 h-3.5 text-gray-600" />;
  };

  const getTrendLabel = () => {
    if (!forecast) return '';
    const rate = Math.abs(forecast.growthRate ?? 0).toFixed(1);
    if (forecast.trend === 'increasing') return `Increasing · +${rate}% growth`;
    if (forecast.trend === 'decreasing') return `Decreasing · -${rate}% decline`;
    return 'Stable · No significant growth';
  };

  const getTrendColor = () => {
    if (!forecast) return 'text-ink-muted';
    if (forecast.trend === 'increasing') return 'text-ink-danger';
    if (forecast.trend === 'decreasing') return 'text-ink-success';
    return 'text-ink-muted';
  };

  const getVolatilityLabel = () => { if (!forecast) return 'Unknown'; if (forecast.volatility < 30) return 'Low'; if (forecast.volatility < 60) return 'Medium'; return 'High'; };
  const getVolatilityColor = () => { if (!forecast) return 'text-gray-600'; if (forecast.volatility < 30) return 'text-ink-success'; if (forecast.volatility < 60) return 'text-ink-warning'; return 'text-ink-danger'; };

  const { isPro } = usePlan();

  if (!isPro) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 min-h-screen">
        <div className="mb-8">
          <p className="text-label font-semibold uppercase tracking-widest text-violet-700 mb-1.5">Costs</p>
          <h1 className={PAGE_TITLE_CLASS}>Forecast</h1>
          <p className={cn(PAGE_SUBTITLE_CLASS, 'mt-1.5')}>Predictive budget forecasting powered by AI.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-violet-600" />
          </div>
          <h2 className="text-ui font-semibold text-gray-900 mb-2">Pro Plan Required</h2>
          <p className="text-ink-muted text-ui max-w-md mx-auto mb-6">
            AI-powered forecasting is available on the Pro plan and above.
          </p>
          <a href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-ui font-semibold no-underline">
            Upgrade to Pro
          </a>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-200 border-t-purple-600 mx-auto mb-4" />
            <Brain className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-purple-600" />
          </div>
          <p className="text-gray-600 mt-4">Generating AI-powered forecast...</p>
          <p className="text-ui text-ink-muted mt-1">Analyzing 90 days of cost data</p>
        </div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-ink-warning mx-auto mb-4" />
          <h3 className="text-ui font-semibold mb-2">Unable to Load Forecast</h3>
          <p className="text-gray-600 mb-4">There was an error loading the forecast data.</p>
          <Button onClick={loadForecast}><RefreshCw className="w-4 h-4 mr-2" />Try Again</Button>
        </Card>
      </div>
    );
  }

  const isDemoMode = forecast.organizationId === 'demo';
  const allChartValues = chartData.flatMap(d => [d.historical, d.predicted, d.upper, d.lower].filter((v): v is number => v !== null));
  const minDataValue = allChartValues.length > 0 ? Math.min(...allChartValues) : 0;
  const maxDataValue = allChartValues.length > 0 ? Math.max(...allChartValues) : 300;
  const yMin = Math.floor((minDataValue * 0.85) / 10) * 10;
  const yMax = Math.ceil((maxDataValue * 1.1) / 10) * 10;

  return (
    <div className="min-h-screen px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 max-w-[1320px] mx-auto">

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-1')}>Cost Forecasting</h1>
          <p className={PAGE_SUBTITLE_CLASS}>AI-powered predictions and scenario planning for your AWS costs</p>
          {!isDemoMode && (
            <p className="text-meta text-ink-muted leading-relaxed mt-1" data-testid="forecast-basis">
              Projected from AWS Cost Explorer daily totals · {TREND_TOTALS_NOTE}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-meta text-ink-muted">Updated {new Date(forecast.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <button onClick={() => setActiveTab('scenarios')} className="bg-white border border-slate-200 text-ink-muted px-3.5 py-2 rounded-lg text-label font-medium cursor-pointer hover:border-slate-300 transition-colors whitespace-nowrap">
            ⚡ What-if scenarios
          </button>
          <button onClick={loadForecast} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-center shrink-0"><RefreshCw className="w-4 h-4 text-ink-muted" /></button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <Card className="hover:shadow-lg transition-shadow border-l-[3px] border-l-violet-600 rounded-l-none">
          <CardContent className="pt-6">
            <p className="text-label font-semibold text-ink-muted uppercase tracking-widest mb-2">Next 30 Days</p>
            <p className="text-section sm:text-kpi text-slate-900 tabular-nums leading-none mb-2">${forecast.predicted30Day.toLocaleString()}</p>
            <p className={`text-meta flex items-center gap-1 ${getTrendColor()}`}>{getTrendIcon()}{getTrendLabel()}</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <p className="text-label font-semibold text-ink-muted uppercase tracking-widest mb-2">Next Quarter</p>
            <p className="text-section sm:text-kpi text-slate-900 tabular-nums leading-none mb-2">${forecast.predictedQuarter.toLocaleString()}</p>
            <p className="text-meta text-ink-muted">~${Math.round(forecast.predictedQuarter / 3).toLocaleString()}/month avg</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <p className="text-label font-semibold text-ink-muted uppercase tracking-widest mb-2">Confidence</p>
            <p className="text-section sm:text-kpi text-slate-900 tabular-nums leading-none mb-2">{forecast.confidence}%</p>
            <p className="text-meta text-ink-muted">High reliability · 90 days data</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <p className="text-label font-semibold text-ink-muted uppercase tracking-widest mb-2">Volatility</p>
            <p className={`text-section sm:text-kpi leading-none mb-2 ${getVolatilityColor()}`}>{getVolatilityLabel()}</p>
            <p className="text-meta text-ink-muted">Predictable billing ahead</p>
          </CardContent>
        </Card>
      </div>

      {/* ── AI SUMMARY ── */}
      <div className="bg-white border border-slate-100 border-l-[3px] border-l-violet-600 rounded-xl p-5 sm:p-7 mb-7">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shrink-0">
            <Lightbulb className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-2 flex flex-wrap items-center gap-2 text-ui">
              AI Forecast Summary
              <span className="text-label font-semibold bg-violet-100 text-violet-700 px-2.5 py-0.5 rounded-full">{forecast.forecastMethod}</span>
            </h3>
            <p className="text-ui text-slate-700 leading-relaxed m-0">
              {forecast.aiSummary || 'Your AWS spend is stable due to consistent EC2 and S3 usage patterns over 90 days.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="flex gap-2 mb-6">
        <Button variant={activeTab === 'forecast' ? 'default' : 'outline'} onClick={() => setActiveTab('forecast')} className="gap-2">
          <TrendingUp className="w-4 h-4" /> Forecast Chart
        </Button>
        <Button variant={activeTab === 'scenarios' ? 'default' : 'outline'} onClick={() => setActiveTab('scenarios')} className="gap-2">
          <Zap className="w-4 h-4" /> What-If Scenarios
        </Button>
      </div>

      {activeTab === 'forecast' && (
        <>
          {/* Chart + Driver panel */}
          <div className="flex flex-col lg:flex-row gap-5 mb-6 items-start">
            <div className="flex-1 min-w-0">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-ui">Cost Forecast</CardTitle>
                      <CardDescription className="text-meta font-medium">Historical spend with AI predictions</CardDescription>
                    </div>
                    <div className="flex items-center gap-4 text-meta">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-blue-500" /><span className="text-ink-muted">Historical</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-violet-500" /><span className="text-ink-muted">Predicted</span></div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {chartData.length === 0 ? (
                    <div className="h-80 flex flex-col items-center justify-center text-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Brain className="w-6 h-6 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-ui font-semibold text-slate-600 mb-1">No forecast data yet</p>
                        <p className="text-meta text-ink-muted">Connect your AWS account to generate AI-powered cost predictions</p>
                      </div>
                    </div>
                  ) : (
                  <div ref={chartContainerRef} style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer width={chartWidth || "100%"} height={320}>
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
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tick={CHART_TICK} tickLine={{ stroke: '#E5E7EB' }} interval="preserveStartEnd" />
                      <YAxis tick={CHART_TICK} tickLine={{ stroke: '#E5E7EB' }} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`} domain={[yMin, yMax]} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP.contentStyle}
                        formatter={(value: any, name: any) => { if (value == null) return ['-', name ?? '']; return [`$${typeof value === 'number' ? value.toLocaleString() : value}/mo`, name === 'historical' ? 'Historical' : name === 'predicted' ? 'Predicted' : name ?? '']; }}
                        labelStyle={CHART_TOOLTIP.labelStyle}
                      />
                      <Area type="monotone" dataKey="upper" stroke="none" fill="#AFA9EC" fillOpacity={0.15} />
                      <Area type="monotone" dataKey="lower" stroke="none" fill="white" fillOpacity={1} />
                      <Area type="monotone" dataKey="historical" stroke="#3B82F6" fill="url(#colorHistorical)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3B82F6' }} />
                      <Area type="monotone" dataKey="predicted" stroke="#8B5CF6" fill="url(#colorPredicted)" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4, fill: '#8B5CF6' }} />
                      <ReferenceLine x={chartData[forecast.historicalData.length]?.date} stroke="#EF4444" strokeDasharray="3 3" strokeWidth={2} label={{ value: 'Today', position: 'top', ...CHART_TICK, fill: '#B91C1C', fontWeight: 600 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Driver panel */}
            {isDemoMode && (
              <div className="w-full lg:w-64 shrink-0 bg-white border border-slate-100 rounded-xl p-5">
                <p className="text-label font-medium text-slate-900 mb-3">What&apos;s driving this forecast</p>
                {[
                  { name: 'Compute (EC2)', pct: 62, amount: '$121/mo', color: '#534AB7' },
                  { name: 'Storage (S3)',  pct: 18, amount: '$35/mo',  color: '#1D9E75' },
                  { name: 'Database (RDS)', pct: 12, amount: '$23/mo', color: '#7F77DD' },
                  { name: 'Network',       pct: 8,  amount: '$16/mo',  color: '#BA7517' },
                ].map((d) => (
                  <div key={d.name} className="mb-3.5">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-meta text-slate-700">{d.name}</span>
                      <div className="text-right">
                        <span className="text-label font-medium text-slate-900 tabular-nums">{d.pct}%</span>
                        <span className="text-meta text-ink-muted ml-1 tabular-nums">{d.amount}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Risks & Recommendations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-ui"><AlertTriangle className="w-5 h-5 text-ink-warning" />Potential Risks</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-none p-0 m-0">
                  {forecast.aiRisks.map((risk, i, arr) => (
                    <li key={i} className={`flex items-start gap-2 py-2 ${i < arr.length - 1 ? 'border-b border-slate-50' : ''}`}>
                      <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: risk.toLowerCase().includes('no significant') ? '#3B6D11' : '#EF9F27' }} />
                      <span className="text-meta text-ink-muted leading-relaxed">{stripMarkdown(risk)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-ui"><Lightbulb className="w-5 h-5 text-blue-600" />Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3 list-none p-0 m-0">
                  {forecast.aiRecommendations.map((rec, index) => (
                    <li key={index} className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                      <ChevronRight className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <span className="text-ui text-slate-700 leading-relaxed">{stripMarkdown(rec)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Alert CTA */}
          <div id="forecast-alert-cta" className="bg-violet-50 border border-violet-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#534AB7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <div>
                <p className="text-label font-medium text-violet-900 m-0">Create forecast-based budget alert</p>
                <p className="text-meta text-violet-600 mt-0.5 m-0">Get notified before your spend exceeds the predicted ${isDemoMode ? '195' : Math.round(forecast.predicted30Day).toLocaleString()} threshold</p>
              </div>
            </div>
            <button onClick={() => router.push('/observability/alerts')} className="bg-violet-700 hover:bg-violet-800 text-white text-label font-medium px-3.5 py-2 rounded-lg border-none cursor-pointer shrink-0 transition-colors whitespace-nowrap">
              Create alert →
            </button>
          </div>
        </>
      )}

      {activeTab === 'scenarios' && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-ui">What-If Scenarios</CardTitle>
              <CardDescription className="text-meta font-medium">Explore how different scenarios would impact your AWS costs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    type: 'traffic_2x' as ScenarioType,
                    params: () => ({ trafficMultiplier: customParams.trafficMultiplier }),
                    icon: <TrendingUp className="w-5 h-5 text-blue-600 group-hover:scale-110 transition-transform" />,
                    title: 'Traffic Increase', desc: 'What if traffic increases?',
                    borderHover: 'hover:border-blue-400 hover:bg-blue-50',
                    input: <div className="flex items-center gap-2"><Input type="number" value={customParams.trafficMultiplier} onChange={e => setCustomParams({ ...customParams, trafficMultiplier: Number(e.target.value) })} onClick={e => e.stopPropagation()} className="w-16 h-8 text-ui" min={1} max={10} /><span className="text-ui text-ink-muted">x multiplier</span></div>,
                  },
                  {
                    type: 'traffic_half' as ScenarioType, params: () => ({}),
                    icon: <TrendingDown className="w-5 h-5 text-ink-warning group-hover:scale-110 transition-transform" />,
                    title: 'Traffic Decrease', desc: 'What if traffic drops 50%?',
                    borderHover: 'hover:border-amber-400 hover:bg-amber-50',
                    input: <span className="text-meta text-ink-muted">Simulates reduced usage</span>,
                  },
                  {
                    type: 'new_service' as ScenarioType, params: () => ({ newServiceCost: customParams.newServiceCost }),
                    icon: <Zap className="w-5 h-5 text-purple-600 group-hover:scale-110 transition-transform" />,
                    title: 'New Service', desc: 'Add a new service',
                    borderHover: 'hover:border-purple-400 hover:bg-purple-50',
                    input: <div className="flex items-center gap-2"><span className="text-ui text-ink-muted">$</span><Input type="number" value={customParams.newServiceCost} onChange={e => setCustomParams({ ...customParams, newServiceCost: Number(e.target.value) })} onClick={e => e.stopPropagation()} className="w-20 h-8 text-ui" min={100} step={100} /><span className="text-ui text-ink-muted">/mo</span></div>,
                  },
                  {
                    type: 'optimization' as ScenarioType, params: () => ({ optimizationSavings: customParams.optimizationSavings }),
                    icon: <DollarSign className="w-5 h-5 text-ink-success group-hover:scale-110 transition-transform" />,
                    title: 'Optimization', desc: 'Apply cost savings',
                    borderHover: 'hover:border-green-400 hover:bg-green-50',
                    input: <div className="flex items-center gap-2"><span className="text-ui text-ink-muted">-$</span><Input type="number" value={customParams.optimizationSavings} onChange={e => setCustomParams({ ...customParams, optimizationSavings: Number(e.target.value) })} onClick={e => e.stopPropagation()} className="w-20 h-8 text-ui" min={100} step={100} /><span className="text-ui text-ink-muted">/mo</span></div>,
                  },
                ].map(({ type, params, icon, title, desc, borderHover, input }) => (
                  <div key={type} onClick={() => generateScenario(type, params())} className={`p-4 border-2 border-dashed border-gray-200 rounded-lg transition-all cursor-pointer group ${borderHover}`}>
                    <div className="flex items-center gap-2 mb-2">{icon}<span className="font-semibold text-gray-900 text-ui">{title}</span></div>
                    <p className="text-ui text-gray-600 mb-3">{desc}</p>
                    {input}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedScenario && (
            <Card className="mb-6 border-2 border-violet-200 bg-slate-50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-ui"><Brain className="w-5 h-5 text-purple-600" />{selectedScenario.name}</CardTitle>
                    <CardDescription className="text-meta font-medium">{selectedScenario.description}</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedScenario(null)}>Clear</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
                  {[
                    { label: 'Baseline (30-day)', value: `$${selectedScenario.baselineCost.toLocaleString()}`, cls: 'bg-white border border-slate-200' },
                    { label: 'Scenario (30-day)', value: `$${selectedScenario.scenarioCost.toLocaleString()}`, cls: 'bg-white border border-slate-200' },
                    {
                      label: 'Impact',
                      value: `${selectedScenario.costDelta > 0 ? '+' : ''}$${selectedScenario.costDelta.toLocaleString()}`,
                      sub: `${selectedScenario.costDelta > 0 ? '+' : ''}${selectedScenario.costDeltaPercent.toFixed(1)}%`,
                      cls: selectedScenario.costDelta > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200',
                      valueColor: selectedScenario.costDelta > 0 ? 'text-ink-danger' : 'text-ink-success',
                    },
                  ].map(({ label, value, sub, cls, valueColor }) => (
                    <div key={label} className={`text-center p-4 rounded-lg ${cls}`}>
                      <p className="text-meta text-ink-muted mb-1">{label}</p>
                      <p className={`text-section tabular-nums m-0 ${valueColor || 'text-slate-900'}`}>{value}</p>
                      {sub && <p className={`text-meta tabular-nums m-0 ${valueColor || 'text-ink-muted'}`}>{sub}</p>}
                    </div>
                  ))}
                </div>
                <div className="p-4 bg-white rounded-lg border border-slate-200 mb-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-slate-900 mb-1 text-ui">AI Analysis</p>
                      <p className="text-ui text-ink-muted leading-relaxed m-0">{selectedScenario.aiAnalysis}</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-white rounded-lg border border-slate-200">
                  <p className="font-semibold text-slate-900 mb-3 text-ui">Recommendations</p>
                  <ul className="flex flex-col gap-2 list-none p-0 m-0">
                    {selectedScenario.aiRecommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <ChevronRight className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                        <span className="text-ui text-ink-muted leading-relaxed">{stripMarkdown(rec)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {scenarios.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-ui">Generated Scenarios</CardTitle>
                <CardDescription className="text-meta font-medium">Compare different scenarios side by side</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        {['Scenario', 'Baseline', 'Scenario Cost', 'Impact', 'Change'].map((h, i) => (
                          <th key={h} className={`py-3 px-4 text-label font-semibold text-ink-muted uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario) => (
                        <tr key={scenario.id} className={`border-b border-slate-50 cursor-pointer transition-colors ${selectedScenario?.id === scenario.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`} onClick={() => setSelectedScenario(scenario)}>
                          <td className="py-3 px-4 text-ui font-semibold text-slate-900">{scenario.name}</td>
                          <td className="py-3 px-4 text-ui text-ink-muted text-right tabular-nums">${scenario.baselineCost.toLocaleString()}</td>
                          <td className="py-3 px-4 text-ui font-semibold text-slate-900 text-right tabular-nums">${scenario.scenarioCost.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-ui font-semibold text-right tabular-nums ${scenario.costDelta > 0 ? 'text-ink-danger' : 'text-ink-success'}`}>{scenario.costDelta > 0 ? '+' : ''}${scenario.costDelta.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-ui text-right tabular-nums ${scenario.costDelta > 0 ? 'text-ink-danger' : 'text-ink-success'}`}>{scenario.costDelta > 0 ? '+' : ''}{scenario.costDeltaPercent.toFixed(1)}%</td>
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