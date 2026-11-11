import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Authentication | DevControl",
  description: "Sign in to your DevControl account",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-950 dark:via-blue-950 dark:to-slate-900">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#8882_1px,transparent_1px),linear-gradient(to_bottom,#8882_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      <div className="relative flex min-h-screen flex-col">
        {/* Header */}
        <header className="container flex h-16 items-center justify-between px-4 sm:px-8">
          <Link href="/" className="flex items-center space-x-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-primary-foreground"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-xl font-bold text-foreground">
              Dev<span className="text-primary">Control</span>
            </span>
          </Link>
        </header>

        {/* Main Content */}
        <main className="container flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-[440px]">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="container border-t bg-background/50 backdrop-blur-sm">
          <div className="flex flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-8">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} DevControl. All rights reserved.
            </p>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/legal/privacy"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Privacy
              </Link>
              <Link
                href="/legal/terms"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Terms
              </Link>
              <a
                href="mailto:support@getdevcontrol.com"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Support
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
