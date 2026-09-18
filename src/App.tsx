import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { MetricCards } from './components/MetricCards';
import { PipelineTopology } from './components/PipelineTopology';
import { DataParityInspector } from './components/DataParityInspector';
import { LiveReplicationStream } from './components/LiveReplicationStream';
import { TableMappingsEditor } from './components/TableMappingsEditor';
import { SyncUnitPanel } from './components/SyncUnitPanel';
import { DeploymentHub } from './components/DeploymentHub';
import { ConnectionSettingsModal } from './components/ConnectionSettingsModal';
import { VpsDatabaseModal } from './components/VpsDatabaseModal';
import { initialTableMappings } from './data/mappings';
import {
  SyncStats,
  SyncEvent,
  TableDataComparison,
  MssqlConfig,
  PostgresConfig,
  SyncSettings,
} from './types';
import { CheckCircle2, AlertTriangle, Info, Terminal, Table, Layers, Database, Zap } from 'lucide-react';

export default function App() {
  // State
  const [stats, setStats] = useState<SyncStats>({
    status: 'running',
    totalSyncedRows: 384,
    rowsPerSecond: 0,
    averageLatencyMs: 24,
    queueBacklog: 0,
    activeWorkers: 2,
    uptimeSeconds: 2520,
    lastSyncTime: new Date().toISOString(),
    failedEventsCount: 0,
    totalInserts: 240,
    totalUpdates: 128,
    totalDeletes: 16,
  });

  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [dataComparison, setDataComparison] = useState<Record<string, TableDataComparison>>({});
  const [isPushing, setIsPushing] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<'sync-unit' | 'parity' | 'stream' | 'mappings'>('sync-unit');

  // Modals
  const [isDeploymentOpen, setIsDeploymentOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVpsDatabaseOpen, setIsVpsDatabaseOpen] = useState(false);

  // Connection testing states
  const [isTestingMssql, setIsTestingMssql] = useState(false);
  const [isTestingPostgres, setIsTestingPostgres] = useState(false);
  const [mssqlTestResult, setMssqlTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [postgresTestResult, setPostgresTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Configs
  const [mssqlConfig, setMssqlConfig] = useState<MssqlConfig>({
    host: '127.0.0.1',
    port: 1433,
    database: 'ProductionERP',
    user: 'sa',
    encrypt: true,
    trustServerCertificate: true,
    syncMode: 'cdc',
    pollIntervalMs: 800,
  });

  const [postgresConfig, setPostgresConfig] = useState<PostgresConfig>({
    connectionString: 'postgresql://postgres:password@72.61.240.34:5432/BOOKLOGIC',
    host: '72.61.240.34',
    port: 5432,
    database: 'BOOKLOGIC',
    user: 'postgres',
    ssl: false,
    schema: 'public',
  });

  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    batchSize: 250,
    pollIntervalMs: 800,
    maxConcurrency: 4,
    conflictResolution: 'source_wins',
    autoCreateTargetTables: true,
    enableDeadLetterQueue: true,
    simulateRealtimeTraffic: false,
  });

  // Notification Toast
  const [toast, setToast] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3800);
  };

  // Fetch status and events
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) {
        const data = await res.json();
        setStats(prev => ({
          ...prev,
          status: data.status,
          totalSyncedRows: data.totalSyncedRows,
          totalInserts: data.totalInserts,
          totalUpdates: data.totalUpdates,
          totalDeletes: data.totalDeletes,
          rowsPerSecond: data.rowsPerSecond,
          averageLatencyMs: data.averageLatencyMs,
          queueBacklog: data.queueBacklog,
          uptimeSeconds: data.uptimeSeconds,
          lastSyncTime: data.lastSyncTime,
          failedEventsCount: data.failedEventsCount,
        }));
        if (data.config) {
          if (data.config.mssql) setMssqlConfig(prev => ({ ...prev, ...data.config.mssql }));
          if (data.config.postgres) setPostgresConfig(prev => ({ ...prev, ...data.config.postgres }));
          if (data.config.settings) setSyncSettings(prev => ({ ...prev, ...data.config.settings }));
        }
      }
    } catch {
      // Background polling error ignored
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // Polling error ignored
    }
  }, []);

  const fetchDataComparison = useCallback(async () => {
    try {
      const res = await fetch('/api/data/compare');
      if (res.ok) {
        const data = await res.json();
        setDataComparison(data);
      }
    } catch {
      // Comparison error ignored
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchEvents();
    fetchDataComparison();

    const interval = setInterval(() => {
      fetchStatus();
      fetchEvents();
      fetchDataComparison();
    }, 1200);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchEvents, fetchDataComparison]);

  // Actions
  const handleControl = async (action: 'start' | 'pause' | 'stop') => {
    try {
      const res = await fetch('/api/sync/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setStats(prev => ({ ...prev, status: data.status }));
        showToast(`Background sync daemon set to: ${action.toUpperCase()}`, 'info');
      }
    } catch {
      showToast('Failed to change service state', 'error');
    }
  };

  const handleInitialPush = async () => {
    setIsPushing(true);
    try {
      const res = await fetch('/api/sync/push-initial', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Initial full snapshot push completed!', 'success');
        fetchStatus();
        fetchEvents();
        fetchDataComparison();
      }
    } catch {
      showToast('Initial push failed', 'error');
    } finally {
      setIsPushing(false);
    }
  };

  const handleSimulateMutation = async (type: string, payload?: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/sync/mutate-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data: payload }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Mutation simulated in Local SQL Server', 'success');
        fetchStatus();
        fetchEvents();
        fetchDataComparison();
      }
    } catch {
      showToast('Simulation failed', 'error');
    }
  };

  const handleTestMssql = async () => {
    setIsTestingMssql(true);
    setMssqlTestResult(null);
    try {
      const res = await fetch('/api/test-mssql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mssqlConfig),
      });
      const data = await res.json();
      setMssqlTestResult({ success: data.connected, message: data.message });
      showToast(data.message, data.connected ? 'success' : 'error');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMssqlTestResult({ success: false, message: msg });
    } finally {
      setIsTestingMssql(false);
    }
  };

  const handleTestPostgres = async (customConfig?: PostgresConfig) => {
    const targetConfig = customConfig || postgresConfig;
    setIsTestingPostgres(true);
    setPostgresTestResult(null);
    try {
      const res = await fetch('/api/test-postgres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetConfig),
      });
      const data = await res.json();
      setPostgresTestResult({ success: data.connected, message: data.message });
      showToast(data.message, data.connected ? 'success' : 'error');
      if (data.connected && customConfig) {
        setPostgresConfig(customConfig);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPostgresTestResult({ success: false, message: msg });
    } finally {
      setIsTestingPostgres(false);
    }
  };

  const handleSaveSettings = async (mssql: MssqlConfig, postgres: PostgresConfig, settings: SyncSettings) => {
    setMssqlConfig(mssql);
    setPostgresConfig(postgres);
    setSyncSettings(settings);
    try {
      await fetch('/api/sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mssql, postgres, settings }),
      });
      showToast('Configuration and pipeline tuning successfully updated.', 'success');
      fetchStatus();
    } catch {
      showToast('Failed to save settings', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 flex flex-col font-sans antialiased">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 duration-200">
          <div className={`px-4 py-3 rounded-xl shadow-lg border flex items-center gap-2.5 text-xs font-medium ${toast.type === 'success' ? 'bg-zinc-900 text-white border-zinc-800' : toast.type === 'info' ? 'bg-blue-900 text-white border-blue-800' : 'bg-rose-900 text-white border-rose-800'}`}>
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
            {toast.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <Header
        status={stats.status}
        uptimeSeconds={stats.uptimeSeconds}
        postgresHost={postgresConfig.host}
        postgresDb={postgresConfig.database}
        onStart={() => handleControl('start')}
        onPause={() => handleControl('pause')}
        onStop={() => handleControl('stop')}
        onInitialPush={handleInitialPush}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDeployment={() => setIsDeploymentOpen(true)}
        onOpenVpsDatabase={() => setIsVpsDatabaseOpen(true)}
        isPushing={isPushing}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* VPS 72.61.240.34 & BOOKLOGIC Target Banner */}
        <div className="bg-gradient-to-r from-zinc-900 via-indigo-950 to-zinc-900 text-white rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-indigo-900/60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600/60 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-xs font-bold tracking-wide uppercase text-indigo-200">
                  Target Virtual Server Destination:
                </span>
                <span className="font-mono text-xs font-semibold bg-indigo-900/90 px-2 py-0.5 rounded text-blue-200 border border-indigo-700">
                  VPS {postgresConfig.host}:5432
                </span>
                <span className="font-mono text-xs font-bold bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-600">
                  /{postgresConfig.database}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 mt-1">
                Active PostgreSQL database <span className="font-mono font-semibold text-emerald-300">{postgresConfig.database}</span> on VPS host <span className="font-mono font-semibold text-blue-300">{postgresConfig.host}</span> configured for real-time background synchronization.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsVpsDatabaseOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 text-xs font-bold transition shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              Provision / Setup BOOKLOGIC
            </button>
          </div>
        </div>

        {/* Metric Cards */}
        <MetricCards stats={stats} />

        {/* Pipeline Architecture Topology */}
        <PipelineTopology
          status={stats.status}
          mssqlHost={mssqlConfig.host}
          mssqlDb={mssqlConfig.database}
          postgresHost={postgresConfig.host}
          postgresDb={postgresConfig.database}
          pollIntervalMs={syncSettings.pollIntervalMs}
          averageLatencyMs={stats.averageLatencyMs}
          onTestMssql={handleTestMssql}
          onTestPostgres={handleTestPostgres}
          onSimulateMutation={handleSimulateMutation}
          onOpenVpsDatabase={() => setIsVpsDatabaseOpen(true)}
          isTestingMssql={isTestingMssql}
          isTestingPostgres={isTestingPostgres}
        />

        {/* View Selection Tabs */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveMainTab('sync-unit')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${activeMainTab === 'sync-unit' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-200'}`}
            >
              <Zap className="w-4 h-4 text-amber-300" />
              Sync Unit (Push Records)
            </button>
            <button
              onClick={() => setActiveMainTab('parity')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${activeMainTab === 'parity' ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Layers className="w-4 h-4 text-blue-600" />
              Live Database Parity
            </button>
            <button
              onClick={() => setActiveMainTab('stream')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${activeMainTab === 'stream' ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Terminal className="w-4 h-4 text-emerald-600" />
              CDC Transaction Stream ({events.length})
            </button>
            <button
              onClick={() => setActiveMainTab('mappings')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${activeMainTab === 'mappings' ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Table className="w-4 h-4 text-indigo-600" />
              Schema Mappings & DDL
            </button>
          </div>

          <span className="text-[11px] text-zinc-400 font-mono hidden sm:inline">
            Active daemon polling: {syncSettings.pollIntervalMs}ms • Batch: {syncSettings.batchSize}
          </span>
        </div>

        {/* Active Tab Panel */}
        {activeMainTab === 'sync-unit' && (
          <SyncUnitPanel
            mappings={initialTableMappings}
            onRefreshParity={fetchDataComparison}
            postgresHost={postgresConfig.host}
            postgresDb={postgresConfig.database}
            mssqlHost={mssqlConfig.host}
            mssqlDb={mssqlConfig.database}
          />
        )}

        {activeMainTab === 'parity' && (
          <DataParityInspector
            dataComparison={dataComparison}
            onRefresh={fetchDataComparison}
            onSimulateMutation={handleSimulateMutation}
          />
        )}

        {activeMainTab === 'stream' && (
          <LiveReplicationStream events={events} />
        )}

        {activeMainTab === 'mappings' && (
          <TableMappingsEditor mappings={initialTableMappings} />
        )}
      </main>

      {/* Deployment Hub Modal */}
      <DeploymentHub
        isOpen={isDeploymentOpen}
        onClose={() => setIsDeploymentOpen(false)}
      />

      {/* Connection & Settings Modal */}
      <ConnectionSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        mssqlConfig={mssqlConfig}
        postgresConfig={postgresConfig}
        syncSettings={syncSettings}
        onSave={handleSaveSettings}
        onTestMssql={handleTestMssql}
        onTestPostgres={handleTestPostgres}
        isTestingMssql={isTestingMssql}
        isTestingPostgres={isTestingPostgres}
        mssqlTestResult={mssqlTestResult}
        postgresTestResult={postgresTestResult}
      />

      {/* VPS Database Provisioner Modal for BOOKLOGIC on 72.61.240.34 */}
      <VpsDatabaseModal
        isOpen={isVpsDatabaseOpen}
        onClose={() => setIsVpsDatabaseOpen(false)}
        onDatabaseCreated={(databaseName, host) => {
          setPostgresConfig(prev => ({
            ...prev,
            database: databaseName,
            host,
            connectionString: `postgresql://postgres:password@${host}:5432/${databaseName}`,
          }));
          showToast(`Target database "${databaseName}" active on VPS ${host}!`, 'success');
          fetchStatus();
        }}
      />
    </div>
  );
}
