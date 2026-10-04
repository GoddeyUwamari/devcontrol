import { SiteAnalytics } from '@/components/analytics/site-analytics';

/**
 * /demo sits outside the route groups, so it gets analytics from here (it
 * used to come from the root layout, which no longer renders it).
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteAnalytics />
    </>
  );
}
