import { MarketingNav } from '@/components/layout/MarketingNav';
import { Footer } from '@/components/footer';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
