import React, { useState } from 'react';
import { Settings, Server, Database, CheckCircle2, AlertTriangle, RefreshCw, Sliders, Eye, EyeOff, Copy, Check, Terminal } from 'lucide-react';
import { MssqlConfig, PostgresConfig, SyncSettings } from '../types';

interface ConnectionSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mssqlConfig: MssqlConfig;
  postgresConfig: PostgresConfig;
  syncSettings: SyncSettings;
  onSave: (mssql: MssqlConfig, postgres: PostgresConfig, settings: SyncSettings) => void;
  onTestMssql: () => void;
  onTestPostgres: (config?: PostgresConfig) => void;
  isTestingMssql: boolean;
  isTestingPostgres: boolean;
  mssqlTestResult: { success: boolean; message: string } | null;
  postgresTestResult: { success: boolean; message: string } | null;
}

export const ConnectionSettingsModal: React.FC<ConnectionSettingsModalProps> = ({
  isOpen,
  onClose,
  mssqlConfig,
  postgresConfig,
  syncSettings,
  onSave,
  onTestMssql,
  onTestPostgres,
  isTestingMssql,
  isTestingPostgres,
  mssqlTestResult,
  postgresTestResult,
}) => {
  const [mssql, setMssql] = useState<MssqlConfig>(mssqlConfig);
  const [postgres, setPostgres] = useState<PostgresConfig>(postgresConfig);
  const [settings, setSettings] = useState<SyncSettings>(syncSettings);
  const [activeTab, setActiveTab] = useState<'source' | 'target' | 'engine'>('source');
  const [showPgPassword, setShowPgPassword] = useState(false);
  const [copiedSql, setCopiedSql] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSql(id);
    setTimeout(() => setCopiedSql(null), 2000);
  };

  const handlePgPasswordChange = (newPass: string) => {
    const updated = {
      ...postgres,
      password: newPass,
      connectionString: `postgresql://${postgres.user || 'postgres'}:${newPass || 'password'}@${postgres.host || '72.61.240.34'}:${postgres.port || 5432}/${postgres.database || 'BOOKLOGIC'}`,
    };
    setPostgres(updated);
  };

  const handlePgUserChange = (newUser: string) => {
    const updated = {
      ...postgres,
      user: newUser,
      connectionString: `postgresql://${newUser || 'postgres'}:${postgres.password || 'password'}@${postgres.host || '72.61.240.34'}:${postgres.port || 5432}/${postgres.database || 'BOOKLOGIC'}`,
    };
    setPostgres(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(mssql, postgres, settings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full border border-zinc-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-zinc-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-400" />
            <h2 className="text-base font-semibold">Database Connections & Engine Configuration</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-base px-2 py-0.5 rounded">
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-2.5 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('source')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${activeTab === 'source' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Local SQL Server (Source)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('target')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${activeTab === 'target' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Virtual Server PostgreSQL (Target)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${activeTab === 'engine' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Background Service Engine
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
          {activeTab === 'source' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900 text-sm">Local Microsoft SQL Server Instance</span>
                <button
                  type="button"
                  onClick={onTestMssql}
                  disabled={isTestingMssql}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingMssql ? 'animate-spin' : ''}`} />
                  {isTestingMssql ? 'Testing...' : 'Test MSSQL Handshake'}
                </button>
              </div>

              {mssqlTestResult && (
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${mssqlTestResult.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                  {mssqlTestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                  <span>{mssqlTestResult.message}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Host / IP</label>
                  <input
                    type="text"
                    value={mssql.host}
                    onChange={(e) => setMssql({ ...mssql, host: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                    placeholder="localhost or 127.0.0.1"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Port</label>
                  <input
                    type="number"
                    value={mssql.port}
                    onChange={(e) => setMssql({ ...mssql, port: parseInt(e.target.value) || 1433 })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Database Name</label>
                  <input
                    type="text"
                    value={mssql.database}
                    onChange={(e) => setMssql({ ...mssql, database: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">User</label>
                  <input
                    type="text"
                    value={mssql.user}
                    onChange={(e) => setMssql({ ...mssql, user: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-600 mb-1 font-medium">Change Detection Mechanism</label>
                <select
                  value={mssql.syncMode}
                  onChange={(e) => setMssql({ ...mssql, syncMode: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                >
                  <option value="cdc">CDC (Change Data Capture - Transaction Log LSNs)</option>
                  <option value="change_tracking">Change Tracking (Lightweight Row-Level Version)</option>
                  <option value="watermark">Timestamp Watermarking (ModifiedAt column polling)</option>
                </select>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mssql.encrypt}
                    onChange={(e) => setMssql({ ...mssql, encrypt: e.target.checked })}
                    className="rounded text-zinc-900"
                  />
                  <span>Encrypt Connection</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mssql.trustServerCertificate}
                    onChange={(e) => setMssql({ ...mssql, trustServerCertificate: e.target.checked })}
                    className="rounded text-zinc-900"
                  />
                  <span>Trust Server Certificate</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'target' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900 text-sm">Virtual Server PostgreSQL Destination</span>
                <button
                  type="button"
                  onClick={() => onTestPostgres(postgres)}
                  disabled={isTestingPostgres}
                  className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 border border-indigo-200 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingPostgres ? 'animate-spin' : ''}`} />
                  {isTestingPostgres ? 'Testing Handshake...' : 'Test PostgreSQL Connection'}
                </button>
              </div>

              {postgresTestResult && (
                <div className={`p-3 rounded-lg text-xs flex flex-col gap-2 border ${postgresTestResult.success ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-rose-50 text-rose-900 border-rose-200'}`}>
                  <div className="flex items-start gap-2">
                    {postgresTestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
                    <span className="font-medium">{postgresTestResult.message}</span>
                  </div>

                  {/* Password Authentication Fix Assistant */}
                  {postgresTestResult.message.toLowerCase().includes('password authentication') && (
                    <div className="mt-1 p-3 bg-white rounded-md border border-rose-300 text-zinc-800 space-y-2 text-[11px]">
                      <div className="font-bold text-rose-900 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-rose-700" />
                        Hostinger VPS Web Terminal Fix: Set or reset password for user "{postgres.user || 'postgres'}"
                      </div>
                      <p className="text-zinc-600">
                        In your open black terminal window (<code className="font-mono bg-zinc-100 px-1 py-0.5 rounded">mum.hostingervps.com</code>), run this 1-liner to set the password:
                      </p>
                      <div className="flex items-center justify-between bg-zinc-950 text-emerald-400 p-2 rounded font-mono text-[11px]">
                        <span>ALTER USER {postgres.user || 'postgres'} WITH PASSWORD '{postgres.password || 'YourSecretPassword123'}';</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(`ALTER USER ${postgres.user || 'postgres'} WITH PASSWORD '${postgres.password || 'YourSecretPassword123'}';`, 'alter-user')}
                          className="inline-flex items-center gap-1 text-[10px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded ml-2"
                        >
                          {copiedSql === 'alter-user' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copiedSql === 'alter-user' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <span className="text-[10px] text-zinc-500 block">
                        Then enter the same password below and click <strong>Test PostgreSQL Connection</strong>.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-zinc-600 mb-1 font-medium">PostgreSQL Connection URL (or configure fields below)</label>
                <input
                  type="text"
                  value={postgres.connectionString || ''}
                  onChange={(e) => setPostgres({ ...postgres, connectionString: e.target.value })}
                  placeholder="postgresql://postgres:password@72.61.240.34:5432/BOOKLOGIC"
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">VPS Server IP / Host</label>
                  <input
                    type="text"
                    value={postgres.host}
                    onChange={(e) => setPostgres({ ...postgres, host: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Port</label>
                  <input
                    type="number"
                    value={postgres.port}
                    onChange={(e) => setPostgres({ ...postgres, port: parseInt(e.target.value) || 5432 })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Username</label>
                  <input
                    type="text"
                    value={postgres.user || ''}
                    onChange={(e) => handlePgUserChange(e.target.value)}
                    placeholder="postgres"
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">PostgreSQL Password</label>
                  <div className="relative">
                    <input
                      type={showPgPassword ? 'text' : 'password'}
                      value={postgres.password || ''}
                      onChange={(e) => handlePgPasswordChange(e.target.value)}
                      placeholder="Enter your VPS PostgreSQL password"
                      className="w-full pl-3 pr-8 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPgPassword(!showPgPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                    >
                      {showPgPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Database Name</label>
                  <input
                    type="text"
                    value={postgres.database}
                    onChange={(e) => setPostgres({ ...postgres, database: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono font-semibold text-emerald-800"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Target Schema</label>
                  <input
                    type="text"
                    value={postgres.schema}
                    onChange={(e) => setPostgres({ ...postgres, schema: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={postgres.ssl}
                  onChange={(e) => setPostgres({ ...postgres, ssl: e.target.checked })}
                  className="rounded text-zinc-900"
                />
                <span>Enable SSL / TLS for Virtual Server Connection</span>
              </label>
            </div>
          )}

          {activeTab === 'engine' && (
            <div className="space-y-3">
              <span className="font-semibold text-zinc-900 text-sm block">Background Service Engine Tuning</span>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Poll Interval (ms)</label>
                  <input
                    type="number"
                    value={settings.pollIntervalMs}
                    onChange={(e) => setSettings({ ...settings, pollIntervalMs: parseInt(e.target.value) || 800 })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                  />
                  <span className="text-[11px] text-zinc-400">Lower means faster real-time sync</span>
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1 font-medium">Batch Size (records per cycle)</label>
                  <input
                    type="number"
                    value={settings.batchSize}
                    onChange={(e) => setSettings({ ...settings, batchSize: parseInt(e.target.value) || 250 })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-600 mb-1 font-medium">Conflict Resolution Strategy</label>
                <select
                  value={settings.conflictResolution}
                  onChange={(e) => setSettings({ ...settings, conflictResolution: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs"
                >
                  <option value="source_wins">Source Wins (Local SQL Server overrides Target)</option>
                  <option value="latest_timestamp">Last-Write-Wins (Compare ModifiedAt timestamps)</option>
                  <option value="target_wins">Target Wins (Preserve Virtual Server changes)</option>
                </select>
              </div>

              <div className="space-y-2 pt-2 border-t border-zinc-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoCreateTargetTables}
                    onChange={(e) => setSettings({ ...settings, autoCreateTargetTables: e.target.checked })}
                    className="rounded text-zinc-900"
                  />
                  <span>Auto-create target tables in PostgreSQL if not present</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableDeadLetterQueue}
                    onChange={(e) => setSettings({ ...settings, enableDeadLetterQueue: e.target.checked })}
                    className="rounded text-zinc-900"
                  />
                  <span>Enable Dead-Letter Queue (DLQ) for failed batches</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.simulateRealtimeTraffic}
                    onChange={(e) => setSettings({ ...settings, simulateRealtimeTraffic: e.target.checked })}
                    className="rounded text-zinc-900"
                  />
                  <span className="font-semibold text-zinc-800">Auto-generate Live Database Traffic (Simulates real-world mutations)</span>
                </label>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-zinc-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-lg font-medium text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-zinc-900 hover:bg-black text-white rounded-lg font-medium text-xs transition shadow-xs"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
