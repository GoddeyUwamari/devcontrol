import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Zap, Bug, Wrench } from 'lucide-react';

export default function ChangelogPage() {
  const releases = [
    {
      version: '2.5.0',
      date: '2024-01-15',
      title: 'DORA Metrics Dashboard',
      changes: [
        { type: 'feature', text: 'New DORA metrics dashboard with deployment frequency, lead time, change failure rate, and MTTR' },
        { type: 'feature', text: 'Team-level DORA metrics comparison' },
        { type: 'improvement', text: 'Improved service dependency visualization' },
        { type: 'fix', text: 'Fixed timezone issues in deployment tracking' },
      ],
    },
    {
      version: '2.4.0',
      date: '2024-01-08',
      title: 'Enhanced AWS Resource Discovery',
      changes: [
        { type: 'feature', text: 'Automatic discovery of RDS, ElastiCache, and Lambda resources' },
        { type: 'feature', text: 'Cost allocation by resource tag' },
        { type: 'improvement', text: 'Faster initial sync for large AWS accounts' },
        { type: 'fix', text: 'Fixed pagination in resource listing' },
      ],
    },
    {
      version: '2.3.0',
      date: '2024-01-01',
      title: 'Team Management',
      changes: [
        { type: 'feature', text: 'Create and manage engineering teams' },
        { type: 'feature', text: 'Assign service ownership to teams' },
        { type: 'feature', text: 'Team-based access control' },
        { type: 'improvement', text: 'Improved onboarding flow for new users' },
      ],
    },
  ];

  const getIcon = (type: string) => {
    switch (type) {
      case 'feature':
        return <Sparkles className="w-3.5 h-3.5 text-blue-600" />;
      case 'improvement':
        return <Zap className="w-3.5 h-3.5 text-green-600" />;
      case 'fix':
        return <Bug className="w-3.5 h-3.5 text-orange-600" />;
      default:
        return <Wrench className="w-3.5 h-3.5 text-gray-600" />;
    }
  };

  const getLabel = (type: string) => {
    switch (type) {
      case 'feature':
        return 'New';
      case 'improvement':
        return 'Improved';
      case 'fix':
        return 'Fixed';
      default:
        return 'Changed';
    }
  };

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Changelog
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            All the latest updates, improvements, and fixes to DevControl.
          </p>
        </div>

        <div className="space-y-8">
          {releases.map((release) => (
            <Card key={release.version}>
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-2.5 py-0.5 text-xs font-bold bg-primary text-primary-foreground rounded-full">
                    v{release.version}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(release.date).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <CardTitle>{release.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {release.changes.map((change, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <span className="flex items-center gap-1.5 mt-0.5">
                        {getIcon(change.type)}
                        <span className={`text-xs font-medium ${
                          change.type === 'feature' ? 'text-blue-600' :
                          change.type === 'improvement' ? 'text-green-600' :
                          'text-orange-600'
                        }`}>
                          {getLabel(change.type)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">{change.text}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-12">
          <p className="text-muted-foreground">
            Want to request a feature?{' '}
            <a href="mailto:feedback@devcontrol.io" className="text-primary hover:underline">
              Let us know
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
