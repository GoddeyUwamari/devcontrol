import { MarketingNav } from '@/components/layout/MarketingNav';
import { Footer } from '@/components/footer';
import { SiteAnalytics } from '@/components/analytics/site-analytics';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white" style={{ overflowX: 'hidden' }}>
      <MarketingNav />
      <main style={{ paddingTop: '104px' }}>{children}</main>
      <Footer />
      <SiteAnalytics />
    </div>
  );
}
