'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export interface ResourceData {
  name: string;
  count: number;
  percentage: number;
  color: string;
}

interface ResourceDistributionChartProps {
  data?: ResourceData[];
  isLoading?: boolean;
  onSegmentClick?: (resource: ResourceData) => void;
}

const defaultData: ResourceData[] = [
  { name: 'EC2 Instances', count: 45, percentage: 28, color: '#3b82f6' },
  { name: 'S3 Buckets', count: 34, percentage: 21, color: '#10b981' },
  { name: 'RDS Databases', count: 23, percentage: 15, color: '#8b5cf6' },
  { name: 'Lambda Functions', count: 28, percentage: 17, color: '#f59e0b' },
  { name: 'Load Balancers', count: 12, percentage: 8, color: '#ef4444' },
  { name: 'Other', count: 14, percentage: 11, color: '#6b7280' },
];

export function ResourceDistributionChart({
  data = defaultData,
  isLoading,
  onSegmentClick,
}: ResourceDistributionChartProps) {
  const totalResources = data.reduce((sum, item) => sum + item.count, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <p className="text-sm font-semibold text-gray-900">{item.name}</p>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-600">Count:</span>
              <span className="font-semibold text-gray-900">{item.count}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-600">Percentage:</span>
              <span className="font-semibold text-gray-900">{item.percentage}%</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle>Resource Distribution</CardTitle>
        <CardDescription>
          Breakdown of your AWS resources by type
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6 items-center">
          {/* Pie Chart */}
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data as unknown as Record<string, unknown>[]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="count"
                  onClick={onSegmentClick ? (_, index) => onSegmentClick(data[index]) : undefined}
                  className={onSegmentClick ? 'cursor-pointer' : ''}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      className="transition-all hover:opacity-80"
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-3xl font-bold fill-gray-900"
                >
                  {totalResources}
                </text>
                <text
                  x="50%"
                  y="50%"
                  dy={24}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-sm fill-gray-600"
                >
                  Total Resources
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend with Details */}
          <div className="space-y-3">
            {data.map((item, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                  onSegmentClick
                    ? 'cursor-pointer hover:bg-gray-50 hover:shadow-md'
                    : ''
                }`}
                onClick={() => onSegmentClick?.(item)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className="w-4 h-4 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.percentage}% of total
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{item.count}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
