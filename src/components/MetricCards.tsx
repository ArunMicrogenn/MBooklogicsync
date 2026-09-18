import React from 'react';
import { ArrowUpRight, Clock, Activity, Layers, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SyncStats } from '../types';

interface MetricCardsProps {
  stats: SyncStats;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Total Synced Records */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">Replicated Records</span>
          <span className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">
            {stats.totalSyncedRows.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-emerald-600">rows</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>+{stats.totalInserts} ins</span>
          <span>•</span>
          <span>~{stats.totalUpdates} upd</span>
          <span>•</span>
          <span>-{stats.totalDeletes} del</span>
        </div>
      </div>

      {/* 2. End-to-End Latency */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">Replication Latency</span>
          <span className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Clock className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">
            {stats.averageLatencyMs}
          </span>
          <span className="text-xs font-medium text-blue-600">ms</span>
        </div>
        <div className="mt-1.5 text-[11px] text-zinc-500">
          MSSQL WAL commit ➔ PostgreSQL flush
        </div>
      </div>

      {/* 3. Throughput */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">CDC Throughput</span>
          <span className="h-7 w-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">
            {stats.rowsPerSecond > 0 ? stats.rowsPerSecond : '0.0'}
          </span>
          <span className="text-xs font-medium text-purple-600">rows / sec</span>
        </div>
        <div className="mt-1.5 text-[11px] text-zinc-500">
          Batch size: 250 • {stats.activeWorkers} async workers
        </div>
      </div>

      {/* 4. Queue Backlog */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">CDC Queue Buffer</span>
          <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${stats.queueBacklog > 0 ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-500'}`}>
            <Layers className="w-4 h-4" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">
            {stats.queueBacklog}
          </span>
          <span className="text-xs font-medium text-zinc-500">queued events</span>
        </div>
        <div className="mt-1.5 text-[11px] text-zinc-500 flex items-center gap-1.5">
          {stats.failedEventsCount > 0 ? (
            <span className="text-rose-600 font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {stats.failedEventsCount} DLQ retries
            </span>
          ) : (
            <span className="text-emerald-600 font-medium">Zero backpressure delay</span>
          )}
        </div>
      </div>
    </div>
  );
};
