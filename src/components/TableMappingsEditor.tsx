import React, { useState } from 'react';
import { Database, ArrowRight, Code, Copy, Check, Table, ShieldCheck } from 'lucide-react';
import { TableMapping } from '../types';
import { sqlServerCdcScript, postgresTargetDdlScript } from '../data/mappings';

interface TableMappingsEditorProps {
  mappings: TableMapping[];
}

export const TableMappingsEditor: React.FC<TableMappingsEditorProps> = ({ mappings }) => {
  const [activeTab, setActiveTab] = useState<'mappings' | 'tsql_script' | 'postgres_ddl'>('mappings');
  const [selectedTableId, setSelectedTableId] = useState<string>(mappings[0]?.id || 'tbl-customers');
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  const selectedTable = mappings.find(m => m.id === selectedTableId) || mappings[0];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedScript(id);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-2xs">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-zinc-100">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Table className="w-4 h-4 text-indigo-600" />
            Table & Schema Type Synchronizer
          </h2>
          <p className="text-xs text-zinc-500">
            Field-by-field type mapping from T-SQL schemas to PostgreSQL target structures
          </p>
        </div>

        {/* Tab Selector */}
        <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
          <button
            onClick={() => setActiveTab('mappings')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${activeTab === 'mappings' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
          >
            Type Mappings
          </button>
          <button
            onClick={() => setActiveTab('tsql_script')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${activeTab === 'tsql_script' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
          >
            T-SQL CDC Script
          </button>
          <button
            onClick={() => setActiveTab('postgres_ddl')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${activeTab === 'postgres_ddl' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
          >
            PostgreSQL DDL
          </button>
        </div>
      </div>

      {activeTab === 'mappings' && (
        <div className="mt-4 space-y-4">
          {/* Table Selector Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {mappings.map(table => (
              <button
                key={table.id}
                onClick={() => setSelectedTableId(table.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 border ${selectedTableId === table.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'}`}
              >
                <span className="font-mono text-zinc-400 text-[11px]">{table.sourceSchema}.</span>
                {table.sourceTable}
                <ArrowRight className="w-3 h-3 text-zinc-400" />
                <span className="font-mono text-emerald-400 text-[11px]">{table.targetSchema}.</span>
                {table.targetTable}
              </button>
            ))}
          </div>

          {/* Selected Table Mapping Details */}
          {selectedTable && (
            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <div className="bg-zinc-50 px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-800">
                  Column Mappings for <span className="font-mono text-blue-700">{selectedTable.sourceSchema}.{selectedTable.sourceTable}</span> ➔ <span className="font-mono text-emerald-700">{selectedTable.targetSchema}.{selectedTable.targetTable}</span>
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">Primary Key: {selectedTable.primaryKey}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-100 text-zinc-600 font-semibold border-b border-zinc-200">
                    <tr>
                      <th className="px-4 py-2">SQL Server Column (Source)</th>
                      <th className="px-4 py-2">Source T-SQL Type</th>
                      <th className="px-4 py-2 text-center">Transform</th>
                      <th className="px-4 py-2">PostgreSQL Column (Target)</th>
                      <th className="px-4 py-2">Target Postgres Type</th>
                      <th className="px-4 py-2">Constraints</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-mono">
                    {selectedTable.columns.map((col, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50/70 transition">
                        <td className="px-4 py-2 text-zinc-900 font-medium">
                          {col.sourceName}
                        </td>
                        <td className="px-4 py-2 text-blue-700 text-[11px]">
                          {col.sourceType}
                        </td>
                        <td className="px-4 py-2 text-center text-zinc-400 font-sans">
                          ➔
                        </td>
                        <td className="px-4 py-2 text-zinc-900 font-medium">
                          {col.targetName}
                        </td>
                        <td className="px-4 py-2 text-emerald-700 text-[11px]">
                          {col.targetType}
                        </td>
                        <td className="px-4 py-2 font-sans">
                          {col.isPrimaryKey ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              PRIMARY KEY
                            </span>
                          ) : col.isNullable ? (
                            <span className="text-zinc-400 text-[11px]">NULL</span>
                          ) : (
                            <span className="text-zinc-600 text-[11px]">NOT NULL</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'tsql_script' && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600 font-medium">
              Execute this T-SQL script in SQL Server Management Studio (SSMS) or Azure Data Studio on Local SQL Server:
            </span>
            <button
              onClick={() => handleCopy(sqlServerCdcScript, 'tsql')}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {copiedScript === 'tsql' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedScript === 'tsql' ? 'Copied to Clipboard!' : 'Copy Script'}
            </button>
          </div>
          <pre className="p-4 bg-zinc-950 text-zinc-200 rounded-lg font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800">
            {sqlServerCdcScript}
          </pre>
        </div>
      )}

      {activeTab === 'postgres_ddl' && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600 font-medium">
              Execute this DDL in psql or pgAdmin on Virtual Server PostgreSQL to provision the mirrored schema:
            </span>
            <button
              onClick={() => handleCopy(postgresTargetDdlScript, 'pg_ddl')}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {copiedScript === 'pg_ddl' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedScript === 'pg_ddl' ? 'Copied to Clipboard!' : 'Copy DDL'}
            </button>
          </div>
          <pre className="p-4 bg-zinc-950 text-emerald-400 rounded-lg font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800">
            {postgresTargetDdlScript}
          </pre>
        </div>
      )}
    </div>
  );
};
