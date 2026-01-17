import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Calendar, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function BlogPage() {
  const posts = [
    {
      title: 'Introducing DORA Metrics in DevControl',
      description: 'Track deployment frequency, lead time, change failure rate, and recovery time with our new DORA metrics dashboard.',
      date: '2024-01-15',
      category: 'Product',
    },
    {
      title: 'Best Practices for Service Catalog Management',
      description: 'Learn how leading engineering teams organize and maintain their service catalogs at scale.',
      date: '2024-01-10',
      category: 'Engineering',
    },
    {
      title: 'Reducing AWS Costs with Infrastructure Visibility',
      description: 'How one team saved 30% on their AWS bill by understanding their infrastructure dependencies.',
      date: '2024-01-05',
      category: 'Case Study',
    },
    {
      title: 'The Platform Engineering Maturity Model',
      description: 'A framework for assessing and improving your internal developer platform.',
      date: '2024-01-01',
      category: 'Engineering',
    },
  ];

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Blog
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Platform engineering insights, product updates, and best practices
            from the DevControl team.
          </p>
        </div>

        <div className="space-y-6">
          {posts.map((post) => (
            <Card key={post.title} className="group hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                    {post.category}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    {new Date(post.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <CardTitle className="flex items-center justify-between">
                  {post.title}
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{post.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-12">
          <p className="text-muted-foreground">
            More posts coming soon. Subscribe to our newsletter for updates.
          </p>
        </div>
      </div>
    </div>
  );
}
