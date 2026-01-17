import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Book, Rocket, FileCode, HelpCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function DocsPage() {
  const sections = [
    {
      title: 'Getting Started',
      description: 'Set up DevControl in under 5 minutes',
      icon: Rocket,
      href: '/docs/getting-started',
    },
    {
      title: 'API Reference',
      description: 'Complete REST API documentation',
      icon: FileCode,
      href: '/docs/api',
    },
    {
      title: 'Guides',
      description: 'Step-by-step tutorials and best practices',
      icon: Book,
      href: '/docs',
    },
    {
      title: 'FAQ',
      description: 'Frequently asked questions',
      icon: HelpCircle,
      href: '/docs',
    },
  ];

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Book className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Documentation
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Everything you need to get started with DevControl. Guides, tutorials,
            and API references to help you build better infrastructure.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title} className="group hover:shadow-md transition-shadow">
                <Link href={section.href}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="flex items-center justify-between">
                      {section.description}
                      <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </CardDescription>
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>

        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            Can't find what you're looking for?
          </p>
          <Button variant="outline" asChild>
            <a href="mailto:support@devcontrol.io">Contact Support</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
