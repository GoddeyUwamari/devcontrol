'use client'

import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { useEffect, useRef, useState } from 'react';

interface LogLine {
  timestamp: number;
  message: string;
}

interface LiveLogViewerProps {
  deploymentId: string;
  logGroupName?: string;
  logStreamName?: string;
}

export function LiveLogViewer({
  deploymentId,
  logGroupName = '/aws/ecs/deployments',
  logStreamName,
}: LiveLogViewerProps) {
  const { socket } = useWebSocket();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;

    // Listen for log stream
    socket.on('logs:stream', (data) => {
      if (data.deploymentId === deploymentId) {
        setLogs(prev => [...prev, ...data.logs]);
        setError(null);
      }
    });

    // Listen for log errors
    socket.on('logs:error', (data) => {
      if (data.deploymentId === deploymentId) {
        setError(data.error);
        setIsStreaming(false);
      }
    });

    // Start log streaming
    const startStreaming = async () => {
      try {
        const response = await fetch(`/api/logs/stream/${deploymentId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({
            logGroupName,
            logStreamName: logStreamName || deploymentId,
          }),
        });

        if (response.ok) {
          setIsStreaming(true);
        } else {
          const data = await response.json();
          setError(data.error || 'Failed to start log streaming');
        }
      } catch (err) {
        setError('Failed to connect to log streaming service');
      }
    };

    startStreaming();

    return () => {
      socket.off('logs:stream');
      socket.off('logs:error');

      // Stop streaming
      fetch(`/api/logs/stop/${deploymentId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
      }).catch(console.error);
    };
  }, [socket, deploymentId, logGroupName, logStreamName]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Live Logs</h3>
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-600 animate-pulse"></span>
              Streaming
            </span>
          )}
          {error && (
            <span className="text-xs text-red-600">Error: {error}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-gray-600 hover:text-gray-900"
            aria-label="Clear logs"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[400px] overflow-auto rounded-md border bg-black p-4 font-mono text-xs text-green-400"
      >
        {logs.length === 0 ? (
          <div className="text-gray-500">
            {isStreaming ? 'Waiting for logs...' : 'No logs available'}
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="py-0.5 hover:bg-gray-900">
              <span className="text-gray-500">
                [{formatTimestamp(log.timestamp)}]
              </span>{' '}
              {log.message}
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-gray-500">
        {logs.length} log line{logs.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
