import React from 'react';
import { Play, Pause, Square, RefreshCw, Zap, Server, Settings, Terminal, Database } from 'lucide-react';
import { SyncStatus } from '../types';

interface HeaderProps {
  status: SyncStatus;
  uptimeSeconds: number;
  postgresHost?: string;
  postgresDb?: string;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onInitialPush: () => void;
  onOpenSettings: () => void;
  onOpenDeployment: () => void;
  onOpenVpsDatabase: () => void;
  isPushing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  uptimeSeconds,
  postgresHost = '72.61.240.34',
  postgresDb = 'BOOKLOGIC',
  onStart,
  onPause,
  onStop,
  onInitialPush,
  onOpenSettings,
  onOpenDeployment,
  onOpenVpsDatabase,
  isPushing,
}) => {
  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Daemon Active (Real-Time CDC)
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            Daemon Paused
          </span>
        );
      case 'stopped':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 border border-zinc-300">
            <span className="h-2 w-2 rounded-full bg-zinc-400"></span>
            Daemon Stopped
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="h-2 w-2 rounded-full bg-rose-500"></span>
            Error State
          </span>
        );
    }
  };

  return (
    <header className="bg-white border-b border-zinc-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* App Title & Identity */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
            <Database className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-zinc-900">
                SQL Server <span className="text-zinc-400 font-normal">➔</span> PostgreSQL Sync
              </h1>
              {getStatusBadge()}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Local MSSQL (1433) to Virtual Server Postgres (5432) Background Pipeline • Uptime: {formatUptime(uptimeSeconds)}
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Initial Push / Snapshot button */}
          <button
            id="btn-initial-push"
            onClick={onInitialPush}
            disabled={isPushing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition shadow-xs disabled:opacity-50"
            title="Push all existing snapshot records from SQL Server to PostgreSQL"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPushing ? 'animate-spin' : ''}`} />
            {isPushing ? 'Pushing Data...' : 'Push Initial Snapshot'}
          </button>

          {/* Service Play / Pause / Stop controls */}
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 bg-zinc-50 shadow-2xs">
            {status !== 'running' ? (
              <button
                id="btn-service-start"
                onClick={onStart}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume
              </button>
            ) : (
              <button
                id="btn-service-pause"
                onClick={onPause}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-50 active:bg-amber-100 transition"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                Pause
              </button>
            )}

            <button
              id="btn-service-stop"
              onClick={onStop}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-600 hover:bg-zinc-200 active:bg-zinc-300 transition"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop
            </button>
          </div>

          {/* Deployment Scripts Hub Button */}
          <button
            id="btn-open-deployment"
            onClick={onOpenDeployment}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 transition shadow-2xs"
          >
            <Terminal className="w-3.5 h-3.5 text-zinc-500" />
            Daemon Scripts
          </button>

          {/* VPS Target DB Button */}
          <button
            id="btn-open-vps-db"
            onClick={onOpenVpsDatabase}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 active:bg-indigo-200 transition shadow-2xs"
            title="Create and verify database BOOKLOGIC on VPS 72.61.240.34"
          >
            <Database className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">VPS:</span> {postgresHost} <span className="font-mono text-[11px] bg-indigo-200/70 text-indigo-900 px-1 rounded">/{postgresDb}</span>
          </button>

          {/* Connection Settings Button */}
          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 transition shadow-2xs"
          >
            <Settings className="w-3.5 h-3.5 text-zinc-500" />
            Config
          </button>
        </div>
      </div>
    </header>
  );
};
