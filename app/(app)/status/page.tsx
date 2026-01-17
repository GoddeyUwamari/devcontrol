import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export default function StatusPage() {
  const services = [
    { name: 'API', status: 'operational', uptime: '99.99%' },
    { name: 'Dashboard', status: 'operational', uptime: '99.98%' },
    { name: 'Data Pipeline', status: 'operational', uptime: '99.95%' },
    { name: 'AWS Integration', status: 'operational', uptime: '99.97%' },
    { name: 'Webhooks', status: 'operational', uptime: '99.99%' },
  ];

  const incidents = [
    {
      date: '2024-01-10',
      title: 'Elevated API Latency',
      status: 'resolved',
      duration: '15 minutes',
    },
    {
      date: '2024-01-05',
      title: 'Dashboard Slow Loading',
      status: 'resolved',
      duration: '8 minutes',
    },
  ];

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            All Systems Operational
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            DevControl is running smoothly. Last updated: {new Date().toLocaleTimeString()}
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Current Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.name} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="font-medium">{service.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{service.uptime} uptime</span>
                    <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full capitalize">
                      {service.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Recent Incidents
            </CardTitle>
            <CardDescription>
              Past incidents from the last 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {incidents.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No incidents in the last 30 days
              </p>
            ) : (
              <div className="space-y-4">
                {incidents.map((incident, idx) => (
                  <div key={idx} className="flex items-start gap-3 py-2 border-b last:border-0">
                    <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{incident.title}</span>
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full capitalize">
                          {incident.status}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {incident.date} - Duration: {incident.duration}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
