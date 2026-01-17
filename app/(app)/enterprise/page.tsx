import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">🏢</span>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            DevControl for Enterprise
          </h1>

          <p className="text-lg text-gray-600 mb-8">
            Enterprise-grade AWS infrastructure management for teams of 100+ engineers. Coming soon!
          </p>

          <Button asChild size="lg">
            <Link href="/dashboard">
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
