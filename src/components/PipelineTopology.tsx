import React from 'react';
import { Database, ArrowRight, Activity, ShieldCheck, Zap, Server, Cpu, RefreshCw } from 'lucide-react';
import { SyncStatus } from '../types';

interface PipelineTopologyProps {
  status: SyncStatus;
  mssqlHost: string;
  mssqlDb: string;
  postgresHost: string;
  postgresDb: string;
  pollIntervalMs: number;
  averageLatencyMs: number;
  onTestMssql: () => void;
  onTestPostgres: () => void;
  onSimulateMutation: (type: string) => void;
  onOpenVpsDatabase?: () => void;
  isTestingMssql: boolean;
  isTestingPostgres: boolean;
}

export const PipelineTopology: React.FC<PipelineTopologyProps> = ({
  status,
  mssqlHost,
  mssqlDb,
  postgresHost,
  postgresDb,
  pollIntervalMs,
  averageLatencyMs,
  onTestMssql,
  onTestPostgres,
  onSimulateMutation,
  onOpenVpsDatabase,
  isTestingMssql,
  isTestingPostgres,
}) => {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-zinc-100">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            Replication Pipeline Architecture & Status
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Continuous Change Data Capture (CDC) streaming from on-premise/local database to cloud virtual server
          </p>
        </div>

        {/* Mutation Simulator Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-zinc-500 mr-1">Simulate in MSSQL:</span>
          <button
            onClick={() => onSimulateMutation('INSERT_CUSTOMER')}
            className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 text-xs font-medium transition"
            title="Inserts a new customer in Local SQL Server"
          >
            + New Customer
          </button>
          <button
            onClick={() => onSimulateMutation('UPDATE_ORDER_STATUS')}
            className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 text-xs font-medium transition"
            title="Updates order status in Local SQL Server"
          >
            ~ Update Order
          </button>
          <button
            onClick={() => onSimulateMutation('UPDATE_INVENTORY_STOCK')}
            className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 text-xs font-medium transition"
            title="Adjusts inventory stock quantity"
          >
            ± Inventory
          </button>
          <button
            onClick={() => onSimulateMutation('BURST_TRAFFIC')}
            className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-medium transition"
            title="Sends a burst of 15 mutations to test batching & throughput"
          >
            ⚡ Burst 15
          </button>
        </div>
      </div>

      {/* Visual Pipeline Topology */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4 relative">
        {/* Node 1: Local SQL Server */}
        <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/70 hover:border-zinc-300 transition relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                MSSQL
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Local SQL Server</h3>
                <span className="text-[11px] text-zinc-500 font-mono">Source • Port 1433</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              CDC ON
            </span>
          </div>

          <div className="mt-3 space-y-1 text-xs text-zinc-600 bg-white p-2.5 rounded-lg border border-zinc-200/80">
            <div className="flex justify-between">
              <span className="text-zinc-400">Host:</span>
              <span className="font-mono text-zinc-700">{mssqlHost}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Database:</span>
              <span className="font-mono text-zinc-700">{mssqlDb}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Tracking:</span>
              <span className="text-emerald-700 font-medium">Native T-SQL CDC</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={onTestMssql}
              disabled={isTestingMssql}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isTestingMssql ? 'animate-spin' : ''}`} />
              {isTestingMssql ? 'Testing...' : 'Test Connection'}
            </button>
            <span className="text-[11px] text-zinc-400">TDS Handshake: OK</span>
          </div>
        </div>

        {/* Node 2: Real-time Background Service Worker */}
        <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50/30 hover:border-emerald-300 transition relative flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">Background Service</h3>
                  <span className="text-[11px] text-zinc-500 font-mono">Sync Daemon / Worker</span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${status === 'running' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {status.toUpperCase()}
              </span>
            </div>

            <div className="mt-3 space-y-1 text-xs text-zinc-600 bg-white p-2.5 rounded-lg border border-emerald-200/80">
              <div className="flex justify-between">
                <span className="text-zinc-400">Loop Cadence:</span>
                <span className="font-mono text-zinc-700">{pollIntervalMs}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Replication Lag:</span>
                <span className="font-semibold text-emerald-700 font-mono">~{averageLatencyMs} ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Transform:</span>
                <span className="text-zinc-700">T-SQL ➔ Postgres Types</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-emerald-800">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Upsert Conflict Guard
            </span>
            <span className="font-mono text-[11px] text-zinc-500">Atomic Batches</span>
          </div>
        </div>

        {/* Node 3: Virtual Server PostgreSQL */}
        <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/70 hover:border-zinc-300 transition relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                PG
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Virtual Server PostgreSQL</h3>
                <span className="text-[11px] text-zinc-500 font-mono">Target VPS • Port 5432</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              SSL ENABLED
            </span>
          </div>

          <div className="mt-3 space-y-1 text-xs text-zinc-600 bg-white p-2.5 rounded-lg border border-zinc-200/80">
            <div className="flex justify-between">
              <span className="text-zinc-400">Endpoint:</span>
              <span className="font-mono text-zinc-700 truncate max-w-[140px]" title={postgresHost}>{postgresHost}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Database:</span>
              <span className="font-mono text-zinc-700">{postgresDb}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Schema:</span>
              <span className="text-zinc-700 font-medium">public</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={onTestPostgres}
              disabled={isTestingPostgres}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isTestingPostgres ? 'animate-spin' : ''}`} />
              {isTestingPostgres ? 'Verifying...' : 'Test Connection'}
            </button>

            {onOpenVpsDatabase && (
              <button
                onClick={onOpenVpsDatabase}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 transition"
              >
                Provision / DB Tools
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
