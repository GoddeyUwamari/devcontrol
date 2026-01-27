import { Lightbulb } from 'lucide-react';

export function ProTip() {
  return (
    <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
      <div className="flex items-start gap-3">
        <Lightbulb className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Pro Tip:</span> Start with your most active service — you&apos;ll see deployment metrics within minutes.
          </p>
        </div>
      </div>
    </div>
  );
}
