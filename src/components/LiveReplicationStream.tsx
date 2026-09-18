import React, { useState } from 'react';
import { Terminal, ArrowRight, CheckCircle2, AlertTriangle, Filter, Copy, Check, Eye } from 'lucide-react';
import { SyncEvent } from '../types';

interface LiveReplicationStreamProps {
  events: SyncEvent[];
  onClearEvents?: () => void;
}

export const LiveReplicationStream: React.FC<LiveReplicationStreamProps> = ({ events }) => {
  const [filterOp, setFilterOp] = useState<string>('ALL');
  const [selectedEvent, setSelectedEvent] = useState<SyncEvent | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredEvents = events.filter(e => {
    if (filterOp === 'ALL') return true;
    return e.operation === filterOp;
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const getOpBadge = (op: string) => {
    switch (op) {
      case 'INSERT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">INSERT</span>;
      case 'UPDATE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">UPDATE</span>;
      case 'DELETE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">DELETE</span>;
      case 'INITIAL_PUSH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">SNAPSHOT</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-100 text-zinc-800">{op}</span>;
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-2xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
            <Terminal className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Real-Time CDC Transaction Log Stream
            </h2>
            <p className="text-xs text-zinc-500">
              Live background service replication packets and SQL statement execution
            </p>
          </div>
        </div>

        {/* Operation Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-zinc-400" />
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
            {['ALL', 'INSERT', 'UPDATE', 'DELETE'].map(op => (
              <button
                key={op}
                onClick={() => setFilterOp(op)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${filterOp === op ? 'bg-white text-zinc-900 shadow-2xs' : 'text-zinc-500 hover:text-zinc-800'}`}
              >
                {op}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events Table / Stream List */}
      <div className="mt-3 overflow-hidden border border-zinc-200 rounded-lg">
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900 text-zinc-300 font-medium sticky top-0 text-[11px]">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Operation</th>
                <th className="px-3 py-2">Pipeline Flow</th>
                <th className="px-3 py-2">LSN (Log Sequence)</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2 text-right">Payload & Query</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-zinc-950 text-zinc-300">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 font-sans text-xs">
                    No transactions recorded for the selected filter. Trigger a mutation above to see live CDC replication.
                  </td>
                </tr>
              ) : (
                filteredEvents.map((evt) => (
                  <tr
                    key={evt.id}
                    className="hover:bg-zinc-900/80 transition cursor-pointer"
                    onClick={() => setSelectedEvent(evt)}
                  >
                    <td className="px-3 py-2 text-zinc-400 text-[11px]">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2">
                      {getOpBadge(evt.operation)}
                    </td>
                    <td className="px-3 py-2 font-sans font-medium text-zinc-200">
                      <span className="text-blue-400">{evt.sourceTable}</span>
                      <span className="text-zinc-600 mx-1.5 font-mono">➔</span>
                      <span className="text-emerald-400">{evt.targetTable}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400 text-[11px] truncate max-w-[140px]" title={evt.lsn}>
                      {evt.lsn}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-emerald-400 font-semibold text-[11px]">{evt.latencyMs}ms</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(evt);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-sans"
                      >
                        <Eye className="w-3 h-3 text-zinc-400" />
                        Inspect SQL
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Event Detail Modal / Slide-out */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full border border-zinc-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-zinc-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">Transaction Packet Inspector</span>
                {getOpBadge(selectedEvent.operation)}
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-zinc-400 hover:text-white text-sm px-2 py-0.5 rounded"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-50 p-3 rounded-lg border border-zinc-200 font-mono text-[11px]">
                <div>
                  <span className="text-zinc-400 block">LSN:</span>
                  <span className="text-zinc-800 font-semibold">{selectedEvent.lsn}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Source:</span>
                  <span className="text-blue-700 font-semibold">{selectedEvent.sourceTable}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Target:</span>
                  <span className="text-emerald-700 font-semibold">{selectedEvent.targetTable}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Replication Lag:</span>
                  <span className="text-purple-700 font-semibold">{selectedEvent.latencyMs} ms</span>
                </div>
              </div>

              {/* Target SQL Query */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-zinc-800 font-sans">Executed Target PostgreSQL SQL:</span>
                  <button
                    onClick={() => copyToClipboard(selectedEvent.targetSql, 'sql')}
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-1 font-sans text-[11px]"
                  >
                    {copiedId === 'sql' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copiedId === 'sql' ? 'Copied' : 'Copy SQL'}
                  </button>
                </div>
                <pre className="p-3 bg-zinc-950 text-emerald-400 rounded-lg font-mono text-[11px] whitespace-pre-wrap border border-zinc-800">
                  {selectedEvent.targetSql}
                </pre>
              </div>

              {/* Source Row Payload */}
              <div>
                <span className="font-semibold text-zinc-800 block mb-1 font-sans">Source SQL Server Record Payload (JSON):</span>
                <pre className="p-3 bg-zinc-900 text-zinc-200 rounded-lg font-mono text-[11px] whitespace-pre-wrap border border-zinc-800">
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            </div>

            <div className="bg-zinc-50 border-t border-zinc-200 px-5 py-3 flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-black font-medium text-xs transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
