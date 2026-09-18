import React, { useState } from 'react';
import { Database, Server, Terminal, Check, Copy, CheckCircle2, AlertTriangle, RefreshCw, Shield, ArrowRight } from 'lucide-react';

interface VpsDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDatabaseCreated: (databaseName: string, host: string) => void;
}

export const VpsDatabaseModal: React.FC<VpsDatabaseModalProps> = ({
  isOpen,
  onClose,
  onDatabaseCreated,
}) => {
  const [host, setHost] = useState('72.61.240.34');
  const [port, setPort] = useState(5432);
  const [databaseName, setDatabaseName] = useState('BOOKLOGIC');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [ssl, setSsl] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    directSuccess?: boolean;
    directError?: string | null;
    message: string;
    commands?: {
      sshCommand: string;
      psqlCommand: string;
      bashSetupScript: string;
    };
  } | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/postgres/create-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          databaseName,
          user,
          password: password || undefined,
          ssl,
        }),
      });

      const data = await res.json();
      setResult(data);
      if (data.success) {
        onDatabaseCreated(data.databaseName, data.host);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({
        success: false,
        message: `Request failed: ${msg}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const defaultSshCommand = `ssh root@${host} "sudo -u postgres psql -c 'CREATE DATABASE \\"${databaseName}\\" WITH OWNER = postgres ENCODING = \\'UTF8\\';'"`;
  const defaultPsqlCommand = `psql -h ${host} -p ${port} -U ${user} -d postgres -c 'CREATE DATABASE "${databaseName}";'`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-zinc-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">
                Provision Database <span className="font-mono text-emerald-400">"{databaseName}"</span> on VPS <span className="font-mono text-blue-300">{host}</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Execute remote PostgreSQL database creation and prepare real-time sync schemas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-base px-2.5 py-1 rounded hover:bg-zinc-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Hostinger VPS Web Terminal Quick Guide - Directly for mum.hostingervps.com */}
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-amber-950 space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 bg-amber-200 text-amber-900 rounded-lg shrink-0 mt-0.5">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-xs text-amber-900">
                  Seen in your Hostinger VPS Web Terminal (<code className="font-mono text-[11px] bg-amber-100 px-1 py-0.5 rounded">mum.hostingervps.com</code>):
                </h3>
                <p className="text-[11px] text-amber-800 mt-1">
                  Your terminal is currently viewing the database list in pager mode (notice the <strong className="font-mono bg-amber-200 px-1 rounded">:</strong> prompt at the bottom left). It cannot accept new SQL commands until you exit the pager.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-[11px] pl-8">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-300 text-amber-950 font-bold flex items-center justify-center shrink-0 text-[10px]">1</span>
                <span>Click inside your black terminal window and press the letter <kbd className="px-1.5 py-0.5 bg-white border border-amber-400 font-mono font-bold rounded text-amber-950 shadow-2xs">q</kbd> on your keyboard to exit the pager back to the <code className="font-mono font-bold text-amber-950">postgres=#</code> prompt.</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-300 text-amber-950 font-bold flex items-center justify-center shrink-0 text-[10px]">2</span>
                <div className="flex-1 flex items-center justify-between gap-2 bg-white/80 p-2 rounded-lg border border-amber-300">
                  <span className="font-mono text-zinc-900 font-semibold select-all">
                    CREATE DATABASE "BOOKLOGIC";
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('CREATE DATABASE "BOOKLOGIC";', 'sql-create')}
                    className="inline-flex items-center gap-1 text-amber-900 hover:text-black font-semibold text-[10px] bg-amber-200 hover:bg-amber-300 px-2 py-1 rounded transition"
                  >
                    {copiedKey === 'sql-create' ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'sql-create' ? 'Copied!' : 'Copy SQL'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-300 text-amber-950 font-bold flex items-center justify-center shrink-0 text-[10px]">3</span>
                <div className="flex-1 flex items-center justify-between gap-2 bg-white/80 p-2 rounded-lg border border-amber-300">
                  <span className="font-mono text-zinc-900 font-semibold select-all">
                    ALTER USER postgres WITH PASSWORD '{password || 'YourPassword123'}';
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(`ALTER USER postgres WITH PASSWORD '${password || 'YourPassword123'}';`, 'sql-pass')}
                    className="inline-flex items-center gap-1 text-amber-900 hover:text-black font-semibold text-[10px] bg-amber-200 hover:bg-amber-300 px-2 py-1 rounded transition"
                  >
                    {copiedKey === 'sql-pass' ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'sql-pass' ? 'Copied!' : 'Copy Password SQL'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-300 text-amber-950 font-bold flex items-center justify-center shrink-0 text-[10px]">4</span>
                <div className="flex-1 flex items-center justify-between gap-2">
                  <span>Verify by typing <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300 font-bold">\l</code> to see <strong className="font-mono text-indigo-900">BOOKLOGIC</strong> in your database list!</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('\\c "BOOKLOGIC"', 'sql-connect')}
                    className="inline-flex items-center gap-1 text-zinc-700 hover:text-black text-[10px] font-mono bg-white border border-amber-300 px-2 py-1 rounded"
                  >
                    {copiedKey === 'sql-connect' ? 'Copied \\c "BOOKLOGIC"' : 'Copy \\c "BOOKLOGIC"'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <form onSubmit={handleCreateDatabase} className="space-y-4 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
              <span className="font-semibold text-zinc-900 text-sm flex items-center gap-1.5">
                <Server className="w-4 h-4 text-zinc-600" />
                VPS Connection Parameters
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-200 text-zinc-700">
                PostgreSQL Engine
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-700 font-medium mb-1">VPS Server IP / Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono font-semibold text-zinc-900"
                  required
                />
              </div>

              <div>
                <label className="block text-zinc-700 font-medium mb-1">Target Database Name</label>
                <input
                  type="text"
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono font-bold text-emerald-700 uppercase"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-zinc-700 font-medium mb-1">PostgreSQL Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 5432)}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-700 font-medium mb-1">Superuser</label>
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-700 font-medium mb-1">Password (if remote port open)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Optional or VPS root password"
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ssl}
                  onChange={(e) => setSsl(e.target.checked)}
                  className="rounded text-zinc-900"
                />
                <span className="text-zinc-700">Require SSL / TLS Connection</span>
              </label>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-black text-white font-medium transition shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Creating Database...' : `Create Database "${databaseName}" on VPS`}
              </button>
            </div>
          </form>

          {/* Execution Result Feedback */}
          {result && (
            <div className={`p-4 rounded-xl border space-y-2 ${result.directSuccess ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-zinc-50 text-zinc-900 border-zinc-300'}`}>
              <div className="flex items-center gap-2 font-semibold">
                {result.directSuccess ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                )}
                <span>{result.message}</span>
              </div>
              {result.directError && (
                <p className="text-[11px] text-zinc-500 font-mono">
                  Remote direct socket notice: {result.directError} (Normal if port 5432 is shielded behind VPS firewall or requires SSH authentication).
                </p>
              )}
            </div>
          )}

          {/* Instant 1-Click SSH Command Generator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-zinc-700" />
                Execute 1-Liner via SSH on VPS <span className="font-mono text-blue-600">{host}</span>:
              </span>
              <button
                onClick={() => handleCopy(result?.commands?.sshCommand || defaultSshCommand, 'ssh')}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium text-[11px]"
              >
                {copiedKey === 'ssh' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'ssh' ? 'Copied SSH Command!' : 'Copy SSH 1-Liner'}
              </button>
            </div>
            <pre className="p-3 bg-zinc-950 text-emerald-400 font-mono text-[11px] rounded-lg border border-zinc-800 overflow-x-auto whitespace-pre-wrap">
              {result?.commands?.sshCommand || defaultSshCommand}
            </pre>
          </div>

          {/* Direct psql CLI command */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-zinc-700" />
                Execute via local psql client to VPS:
              </span>
              <button
                onClick={() => handleCopy(result?.commands?.psqlCommand || defaultPsqlCommand, 'psql')}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium text-[11px]"
              >
                {copiedKey === 'psql' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'psql' ? 'Copied psql Command!' : 'Copy psql Command'}
              </button>
            </div>
            <pre className="p-3 bg-zinc-950 text-zinc-200 font-mono text-[11px] rounded-lg border border-zinc-800 overflow-x-auto whitespace-pre-wrap">
              {result?.commands?.psqlCommand || defaultPsqlCommand}
            </pre>
          </div>

          {/* Firewall & Network Guide for VPS */}
          <div className="bg-zinc-100 p-3.5 rounded-lg border border-zinc-200 text-zinc-700 space-y-1.5 text-[11px]">
            <span className="font-semibold text-zinc-900 block">VPS Firewall & Remote Sync Checklist for {host}:</span>
            <ul className="list-disc list-inside space-y-1 text-zinc-600">
              <li>Ensure PostgreSQL is listening on all interfaces in <code className="font-mono bg-white px-1 py-0.5 rounded border border-zinc-300">/etc/postgresql/16/main/postgresql.conf</code>: <code className="font-mono text-zinc-900">listen_addresses = '*'</code></li>
              <li>Add remote sync client IP authorization in <code className="font-mono bg-white px-1 py-0.5 rounded border border-zinc-300">/etc/postgresql/16/main/pg_hba.conf</code>: <code className="font-mono text-zinc-900">host all all 0.0.0.0/0 scram-sha-256</code></li>
              <li>Allow firewall incoming port 5432: <code className="font-mono text-zinc-900">sudo ufw allow 5432/tcp</code></li>
              <li>Reload PostgreSQL: <code className="font-mono text-zinc-900">sudo systemctl restart postgresql</code></li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-zinc-50 border-t border-zinc-200 px-6 py-3 flex items-center justify-between">
          <span className="text-zinc-500 text-xs">
            Target: <span className="font-mono font-semibold text-zinc-800">{host}:5432/{databaseName}</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-900 hover:bg-black text-white rounded-lg text-xs font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
