import React, { useState } from 'react';
import { Terminal, Copy, Check, Download, Layers, ShieldCheck, Server, Cpu } from 'lucide-react';
import {
  nodeBackgroundServiceScript,
  pythonBackgroundWorkerScript,
  windowsServiceScript,
  linuxSystemdServiceScript,
  dockerComposeScript,
} from '../data/standaloneScripts';

interface DeploymentHubProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeploymentHub: React.FC<DeploymentHubProps> = ({ isOpen, onClose }) => {
  const [selectedScript, setSelectedScript] = useState<'node' | 'python' | 'windows' | 'systemd' | 'docker'>('node');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const scripts = {
    node: {
      name: 'Node.js Background Daemon (Recommended)',
      filename: 'sync-daemon.js',
      description: 'Production-ready Node.js background daemon using mssql and pg with CDC query loops, batch upserts, and graceful shutdown.',
      content: nodeBackgroundServiceScript,
      command: 'npm install mssql pg dotenv && node sync-daemon.js\n# Or run as background service:\npm2 start sync-daemon.js --name "mssql-to-pg-sync"',
    },
    python: {
      name: 'Python Background Worker',
      filename: 'sync_worker.py',
      description: 'Python background daemon using pyodbc and psycopg2 with batch execution and change tracking queries.',
      content: pythonBackgroundWorkerScript,
      command: 'pip install pyodbc psycopg2-binary python-dotenv && python sync_worker.py',
    },
    windows: {
      name: 'Windows Service (PowerShell)',
      filename: 'Install-SyncService.ps1',
      description: 'PowerShell script to register and run the background service daemon as an un-interruptible Windows Service.',
      content: windowsServiceScript,
      command: 'powershell -ExecutionPolicy Bypass -File Install-SyncService.ps1',
    },
    systemd: {
      name: 'Linux systemd Unit',
      filename: 'sql-pg-sync.service',
      description: 'systemd service definition for Virtual Server / Linux hosts with auto-restart on failure.',
      content: linuxSystemdServiceScript,
      command: 'sudo cp sql-pg-sync.service /etc/systemd/system/\nsudo systemctl daemon-reload\nsudo systemctl enable --now sql-pg-sync',
    },
    docker: {
      name: 'Docker Compose Container',
      filename: 'docker-compose.yml',
      description: 'Dockerized background sync container with network bridge to host database instances.',
      content: dockerComposeScript,
      command: 'docker compose up -d',
    },
  };

  const current = scripts[selectedScript];

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-4xl w-full border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-zinc-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold">Standalone Background Service Deployment Hub</h2>
              <p className="text-xs text-zinc-400">
                Deploy the background synchronization worker daemon directly on your Local SQL Server or Virtual Server
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-lg px-2.5 py-1 rounded hover:bg-zinc-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Script Tabs */}
        <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-2.5 flex items-center gap-2 overflow-x-auto text-xs">
          <button
            onClick={() => setSelectedScript('node')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${selectedScript === 'node' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Node.js Daemon
          </button>
          <button
            onClick={() => setSelectedScript('python')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${selectedScript === 'python' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Python Worker
          </button>
          <button
            onClick={() => setSelectedScript('windows')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${selectedScript === 'windows' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Windows Service (PowerShell)
          </button>
          <button
            onClick={() => setSelectedScript('systemd')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${selectedScript === 'systemd' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Linux systemd
          </button>
          <button
            onClick={() => setSelectedScript('docker')}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${selectedScript === 'docker' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
          >
            Docker Compose
          </button>
        </div>

        {/* Script Content Area */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">{current.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{current.description}</p>
          </div>

          {/* Execution Command Box */}
          <div className="bg-zinc-900 text-zinc-100 p-3 rounded-lg border border-zinc-800">
            <div className="flex items-center justify-between mb-1.5 text-zinc-400 text-[11px] font-sans font-medium">
              <span>Quick Run Command:</span>
              <button
                onClick={() => handleCopy(current.command, 'cmd')}
                className="text-zinc-300 hover:text-white flex items-center gap-1"
              >
                {copiedKey === 'cmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'cmd' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="font-mono text-emerald-400 text-xs whitespace-pre-wrap">{current.command}</pre>
          </div>

          {/* Script Code View */}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <div className="bg-zinc-100 px-4 py-2 border-b border-zinc-200 flex items-center justify-between">
              <span className="font-mono font-medium text-zinc-700">{current.filename}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCopy(current.content, 'code')}
                  className="inline-flex items-center gap-1 text-zinc-700 hover:text-zinc-900 font-medium"
                >
                  {copiedKey === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'code' ? 'Copied Full Code' : 'Copy Code'}
                </button>
                <button
                  onClick={() => handleDownload(current.filename, current.content)}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download File
                </button>
              </div>
            </div>
            <pre className="p-4 bg-zinc-950 text-zinc-200 font-mono text-[11px] overflow-x-auto max-h-72 whitespace-pre leading-relaxed">
              {current.content}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-zinc-50 border-t border-zinc-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-500 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Runs as an isolated background daemon with auto-recovery and zero data loss</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-black text-white text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
