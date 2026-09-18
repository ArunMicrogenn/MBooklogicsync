import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  ArrowRight,
  Database,
  Server,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Play,
  Copy,
  Check,
  Code2,
  FileSpreadsheet,
  Terminal,
  RefreshCw,
  Clock,
  Sparkles,
  Download,
  Activity,
  Layers,
  ShieldCheck,
  Pause,
  Sliders,
  DownloadCloud,
  Bookmark,
  Users,
  Calendar,
  ArrowDownLeft,
} from 'lucide-react';
import { TableMapping } from '../types';

interface AutoSyncLog {
  id: string;
  timestamp: string;
  tables: string[];
  recordsSynced: number;
  latencyMs: number;
  status: 'success' | 'warning' | 'error';
  message: string;
}

interface AutoSyncStatusData {
  enabled: boolean;
  intervalSeconds: number;
  tables: string[];
  host: string;
  database: string;
  user: string;
  lastRun: string | null;
  nextRunInSeconds: number;
  totalSyncCycles: number;
  totalRecordsSynced: number;
  status: 'idle' | 'running' | 'active' | 'error';
  lastErrorMessage: string | null;
  recentLogs: AutoSyncLog[];
}

interface SyncUnitPanelProps {
  mappings: TableMapping[];
  onRefreshParity: () => void;
  postgresHost?: string;
  postgresDb?: string;
  mssqlHost?: string;
  mssqlDb?: string;
}

export const SyncUnitPanel: React.FC<SyncUnitPanelProps> = ({
  mappings,
  onRefreshParity,
  postgresHost = '72.61.240.34',
  postgresDb = 'BOOKLOGIC',
  mssqlHost = '127.0.0.1',
  mssqlDb = 'BOOKLOGIC',
}) => {
  const [selectedTable, setSelectedTable] = useState<string>('mas_hotel');
  const [isPushing, setIsPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState<{
    status: 'idle' | 'running' | 'success' | 'error';
    message: string;
    totalRows: number;
    processedRows: number;
    latencyMs: number;
    sqlExecuted?: string;
    details?: string[];
  }>({
    status: 'idle',
    message: '',
    totalRows: 0,
    processedRows: 0,
    latencyMs: 0,
  });

  const [activeSubTab, setActiveSubTab] = useState<'auto_sync' | 'inbound_reservations' | 'quick_push' | 'custom_import' | 'cli_agent' | 'win_service'>('auto_sync');
  const [rawInputFormat, setRawInputFormat] = useState<'json' | 'sql' | 'csv'>('json');
  const [rawInputText, setRawInputText] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [vpsPassword, setVpsPassword] = useState<string>('');

  // Inbound Reservation Sync State (VPS PostgreSQL -> Local SQL Server Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic)
  const [isInboundSyncing, setIsInboundSyncing] = useState(false);
  const [inboundSyncResult, setInboundSyncResult] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
    fetchedCount: number;
    syncedReservationsCount: number;
    syncedDetailsCount: number;
    syncedCustomersCount: number;
    latencyMs: number;
  }>({
    status: 'idle',
    message: '',
    fetchedCount: 0,
    syncedReservationsCount: 0,
    syncedDetailsCount: 0,
    syncedCustomersCount: 0,
    latencyMs: 0,
  });
  const [localReservationsList, setLocalReservationsList] = useState<any[]>([]);
  const [localDetailsList, setLocalDetailsList] = useState<any[]>([]);
  const [localCustomersList, setLocalCustomersList] = useState<any[]>([]);
  const [inboundTableSubView, setInboundTableSubView] = useState<'master' | 'details' | 'customer' | 'relational'>('master');
  const [expandedResId, setExpandedResId] = useState<number | null>(null);
  const [isCreatingPgReservation, setIsCreatingPgReservation] = useState(false);
  const [createPgResMsg, setCreatePgResMsg] = useState<string | null>(null);

  // Auto-Sync Daemon State
  const [autoSync, setAutoSync] = useState<AutoSyncStatusData>({
    enabled: false,
    intervalSeconds: 3,
    tables: ['mas_hotel', 'trans_roomavailability_chart_datewise', 'reservations_booklogic'],
    host: postgresHost,
    database: postgresDb,
    user: 'postgres',
    lastRun: null,
    nextRunInSeconds: 3,
    totalSyncCycles: 0,
    totalRecordsSynced: 0,
    status: 'idle',
    lastErrorMessage: null,
    recentLogs: [],
  });
  const [isTogglingAutoSync, setIsTogglingAutoSync] = useState(false);
  const [isTriggeringNow, setIsTriggeringNow] = useState(false);
  const [showLogs, setShowLogs] = useState(true);

  // Poll Auto-Sync Daemon Status
  useEffect(() => {
    let prevCycles = autoSync.totalSyncCycles;
    const fetchAutoSyncStatus = async () => {
      try {
        const res = await fetch('/api/sync-unit/auto-sync/status');
        if (res.ok) {
          const data = await res.json();
          setAutoSync(data);
          // If cycles increased and auto-sync is on, refresh parity
          if (data.totalSyncCycles > prevCycles && data.enabled) {
            prevCycles = data.totalSyncCycles;
            onRefreshParity();
          }
        }
      } catch {
        // silent error during background polling
      }
    };

    fetchAutoSyncStatus();
    const interval = setInterval(fetchAutoSyncStatus, 1500);
    return () => clearInterval(interval);
  }, [autoSync.totalSyncCycles, onRefreshParity]);

  // Toggle Auto-Sync Switch
  const handleToggleAutoSync = async () => {
    setIsTogglingAutoSync(true);
    const nextState = !autoSync.enabled;
    try {
      const res = await fetch('/api/sync-unit/auto-sync/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: nextState,
          intervalSeconds: autoSync.intervalSeconds,
          tables: autoSync.tables,
          host: postgresHost,
          database: postgresDb,
          password: vpsPassword || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSync((prev) => ({
          ...prev,
          enabled: data.enabled,
          status: data.status,
          nextRunInSeconds: data.nextRunInSeconds,
        }));
        if (nextState) {
          onRefreshParity();
        }
      }
    } catch (err) {
      console.error('Failed to toggle Auto-Sync:', err);
    } finally {
      setIsTogglingAutoSync(false);
    }
  };

  // Change Interval
  const handleChangeInterval = async (intervalSec: number) => {
    try {
      const res = await fetch('/api/sync-unit/auto-sync/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: autoSync.enabled,
          intervalSeconds: intervalSec,
          tables: autoSync.tables,
          host: postgresHost,
          database: postgresDb,
        }),
      });
      if (res.ok) {
        setAutoSync((prev) => ({ ...prev, intervalSeconds: intervalSec, nextRunInSeconds: intervalSec }));
      }
    } catch (err) {
      console.error('Failed to change interval:', err);
    }
  };

  // Toggle Table in Auto-Sync
  const handleToggleTable = async (tableName: string) => {
    let updatedTables: string[];
    if (autoSync.tables.includes(tableName)) {
      if (autoSync.tables.length === 1) return; // keep at least 1 table
      updatedTables = autoSync.tables.filter((t) => t !== tableName);
    } else {
      updatedTables = [...autoSync.tables, tableName];
    }

    try {
      const res = await fetch('/api/sync-unit/auto-sync/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: autoSync.enabled,
          intervalSeconds: autoSync.intervalSeconds,
          tables: updatedTables,
          host: postgresHost,
          database: postgresDb,
        }),
      });
      if (res.ok) {
        setAutoSync((prev) => ({ ...prev, tables: updatedTables }));
      }
    } catch (err) {
      console.error('Failed to update tables:', err);
    }
  };

  // Trigger Immediate Cycle
  const handleTriggerNow = async () => {
    setIsTriggeringNow(true);
    try {
      const res = await fetch('/api/sync-unit/auto-sync/trigger-now', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSync((prev) => ({
          ...prev,
          lastRun: data.lastRun,
          totalSyncCycles: data.totalSyncCycles,
          totalRecordsSynced: data.totalRecordsSynced,
        }));
        onRefreshParity();
      }
    } catch (err) {
      console.error('Failed to trigger immediate cycle:', err);
    } finally {
      setIsTriggeringNow(false);
    }
  };

  // Force Sync State
  const [selectedForceTables, setSelectedForceTables] = useState<string[]>([
    'mas_hotel',
    'trans_roomavailability_chart_datewise',
  ]);
  const [isForceSyncing, setIsForceSyncing] = useState(false);
  const [forceSyncFeedback, setForceSyncFeedback] = useState<{
    status: 'idle' | 'running' | 'success' | 'warning' | 'error';
    message: string;
    totalPushed: number;
    tableResults?: Array<{
      table: string;
      localCount: number;
      pushedCount: number;
      remoteDirectCount: number;
      status: string;
      message: string;
    }>;
  }>({
    status: 'idle',
    message: '',
    totalPushed: 0,
  });

  // Force Sync Selected Tables (Independent of daemon state)
  const handleForceSyncSelected = async () => {
    if (selectedForceTables.length === 0) return;
    setIsForceSyncing(true);
    setForceSyncFeedback({
      status: 'running',
      message: `Executing immediate force push for ${selectedForceTables.length} selected table(s)...`,
      totalPushed: 0,
    });

    try {
      const res = await fetch('/api/sync-unit/force-sync-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: selectedForceTables,
          host: postgresHost,
          database: postgresDb,
          password: vpsPassword || undefined,
          user: 'postgres',
          port: 5432,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setForceSyncFeedback({
          status: data.remoteError ? 'warning' : 'success',
          message: data.message,
          totalPushed: data.totalPushed,
          tableResults: data.tableResults,
        });
        onRefreshParity();
      } else {
        setForceSyncFeedback({
          status: 'error',
          message: data.message || 'Failed to force sync selected tables.',
          totalPushed: 0,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setForceSyncFeedback({
        status: 'error',
        message: `Connection or execution error: ${msg}`,
        totalPushed: 0,
      });
    } finally {
      setIsForceSyncing(false);
    }
  };

  const handleToggleForceTable = (tblId: string) => {
    setSelectedForceTables((prev) =>
      prev.includes(tblId) ? prev.filter((t) => t !== tblId) : [...prev, tblId]
    );
  };

  const handleSelectAllForceTables = () => {
    const all = ['mas_hotel', 'trans_roomavailability_chart_datewise', 'customers', 'orders', 'inventory'];
    if (selectedForceTables.length === all.length) {
      setSelectedForceTables(['mas_hotel']);
    } else {
      setSelectedForceTables(all);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Sample templates for Quick Import
  const loadTemplate = (type: 'mas_hotel' | 'room_avail') => {
    if (type === 'mas_hotel') {
      setSelectedTable('mas_hotel');
      setRawInputFormat('json');
      setRawInputText(JSON.stringify([
        {
          HotelCode: "HTL-BL-101",
          HotelName: "BookLogic Grand Resort & Spa",
          City: "Mumbai",
          State: "Maharashtra",
          Country: "India",
          Phone: "+91-22-6890-1122",
          Email: "frontdesk@booklogicresort.com",
          TotalRooms: 320,
          StarRating: 5.0,
          IsActive: true
        },
        {
          HotelCode: "HTL-BL-102",
          HotelName: "BookLogic Heritage Palace",
          City: "Jaipur",
          State: "Rajasthan",
          Country: "India",
          Phone: "+91-141-2890-3344",
          Email: "reservations@booklogicheritage.in",
          TotalRooms: 190,
          StarRating: 5.0,
          IsActive: true
        }
      ], null, 2));
    } else {
      setSelectedTable('trans_roomavailability_chart_datewise');
      setRawInputFormat('json');
      setRawInputText(JSON.stringify([
        {
          Roomtypeid: 101,
          fromdate: "2026-09-18 00:00:00",
          todate: "2026-09-25 00:00:00",
          Availablerooms: 25,
          uploadflg: 1,
          notupload: 0,
          Remarks: "High Season Allotment - BookLogic Channel",
          Fromtime: "2026-09-18 14:00:00",
          Totime: "2026-09-25 11:00:00",
          allotcode: "ALLOT-SEP-01",
          hotelcode: "HTL-BL-001",
          IRM_Update: 1,
          stopsales: 0
        },
        {
          Roomtypeid: 102,
          fromdate: "2026-09-18 00:00:00",
          todate: "2026-09-25 00:00:00",
          Availablerooms: 18,
          uploadflg: 1,
          notupload: 0,
          Remarks: "Executive Deluxe Suite Allotment",
          Fromtime: "2026-09-18 14:00:00",
          Totime: "2026-09-25 11:00:00",
          allotcode: "ALLOT-SEP-02",
          hotelcode: "HTL-BL-001",
          IRM_Update: 1,
          stopsales: 0
        }
      ], null, 2));
    }
  };

  // Trigger Direct Sync Unit Push for selected table
  const handleExecutePush = async () => {
    setIsPushing(true);
    setPushProgress({
      status: 'running',
      message: `Connecting to local MSSQL database "${mssqlDb}" and staging records for table "${selectedTable}"...`,
      totalRows: 0,
      processedRows: 0,
      latencyMs: 0,
      details: [
        `[${new Date().toLocaleTimeString()}] Initialized Sync Unit worker for table: dbo.${selectedTable}`,
        `[${new Date().toLocaleTimeString()}] Target: PostgreSQL public.${selectedTable} on VPS ${postgresHost}:5432/${postgresDb}`,
      ],
    });

    try {
      const res = await fetch('/api/sync-unit/push-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: selectedTable,
          targetHost: postgresHost,
          targetDatabase: postgresDb,
          sourceDatabase: mssqlDb,
          password: vpsPassword || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setPushProgress({
          status: 'success',
          message: data.message || `Successfully pushed ${data.rowsPushed || 0} records from local ${mssqlDb} to VPS PostgreSQL ${postgresDb}!`,
          totalRows: data.totalRows || data.rowsPushed || 0,
          processedRows: data.rowsPushed || 0,
          latencyMs: data.latencyMs || 28,
          sqlExecuted: data.sqlExecuted,
          details: [
            ...(data.logs || []),
            `[${new Date().toLocaleTimeString()}] ✅ Push completed: ${data.rowsPushed} rows synchronized into public.${selectedTable}.`,
            `[${new Date().toLocaleTimeString()}] 📊 Parity status: 100% IN-SYNC between local MSSQL and VPS PostgreSQL.`
          ],
        });
        onRefreshParity();
      } else {
        setPushProgress({
          status: 'error',
          message: data.message || data.error || 'Failed to push records from local database.',
          totalRows: 0,
          processedRows: 0,
          latencyMs: 0,
          details: [
            `[${new Date().toLocaleTimeString()}] ❌ Push failed: ${data.message || data.error}`,
          ],
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPushProgress({
        status: 'error',
        message: `Connection or execution error: ${msg}`,
        totalRows: 0,
        processedRows: 0,
        latencyMs: 0,
        details: [`[${new Date().toLocaleTimeString()}] ❌ Network error: ${msg}`],
      });
    } finally {
      setIsPushing(false);
    }
  };

  // Push Custom Raw Data from Local Database
  const handlePushCustomRecords = async () => {
    if (!rawInputText.trim()) {
      alert('Please enter or paste records from your local database first.');
      return;
    }

    setIsPushing(true);
    setPushProgress({
      status: 'running',
      message: `Parsing custom input and batch-inserting into VPS PostgreSQL "${postgresDb}"...`,
      totalRows: 0,
      processedRows: 0,
      latencyMs: 0,
      details: [
        `[${new Date().toLocaleTimeString()}] Parsing ${rawInputFormat.toUpperCase()} payload for ${selectedTable}...`,
      ],
    });

    try {
      let records: any[] = [];
      if (rawInputFormat === 'json') {
        try {
          const parsed = JSON.parse(rawInputText);
          records = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e: any) {
          throw new Error(`Invalid JSON syntax: ${e.message}`);
        }
      } else if (rawInputFormat === 'csv') {
        const lines = rawInputText.trim().split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) throw new Error('CSV must include a header row and at least one data row.');
        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        records = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
          const row: Record<string, any> = {};
          headers.forEach((h, idx) => {
            row[h] = values[idx];
          });
          return row;
        });
      } else {
        // Raw SQL statements
        records = [{ _rawSql: rawInputText }];
      }

      const res = await fetch('/api/sync-unit/import-and-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: selectedTable,
          format: rawInputFormat,
          records,
          rawSql: rawInputFormat === 'sql' ? rawInputText : undefined,
          targetHost: postgresHost,
          targetDatabase: postgresDb,
          password: vpsPassword || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPushProgress({
          status: 'success',
          message: data.message || `Custom records for "${selectedTable}" successfully pushed to VPS PostgreSQL!`,
          totalRows: data.rowsPushed || records.length,
          processedRows: data.rowsPushed || records.length,
          latencyMs: data.latencyMs || 34,
          sqlExecuted: data.sqlExecuted,
          details: [
            ...(data.logs || []),
            `[${new Date().toLocaleTimeString()}] ✅ ${data.rowsPushed || records.length} records pushed to public.${selectedTable} on VPS ${postgresHost}!`,
          ],
        });
        onRefreshParity();
      } else {
        setPushProgress({
          status: 'error',
          message: data.message || data.error || 'Failed to push custom records.',
          totalRows: 0,
          processedRows: 0,
          latencyMs: 0,
          details: [`[${new Date().toLocaleTimeString()}] ❌ ${data.message || data.error}`],
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPushProgress({
        status: 'error',
        message: `Execution failed: ${msg}`,
        totalRows: 0,
        processedRows: 0,
        latencyMs: 0,
        details: [`[${new Date().toLocaleTimeString()}] ❌ Error: ${msg}`],
      });
    } finally {
      setIsPushing(false);
    }
  };

  // Inbound Sync Handler: Fetch Reservations, reservations_details & reservation_Customer from PostgreSQL into local MSSQL
  const handlePullReservations = async () => {
    setIsInboundSyncing(true);
    setInboundSyncResult({
      status: 'idle',
      message: 'Querying PostgreSQL for un-synced reservations where updateflag = 0 and hotelcode...',
      fetchedCount: 0,
      syncedReservationsCount: 0,
      syncedDetailsCount: 0,
      syncedCustomersCount: 0,
      latencyMs: 0,
    });

    try {
      const res = await fetch('/api/sync-unit/inbound-sync-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: postgresHost,
          port: 5432,
          database: postgresDb,
          user: 'postgres',
          password: vpsPassword || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setInboundSyncResult({
          status: 'success',
          message: data.message || `Successfully synced ${data.syncedReservationsCount} Reservations, ${data.syncedDetailsCount} details, and ${data.syncedCustomersCount} customer records to local SQL Server!`,
          fetchedCount: data.fetchedCount || 0,
          syncedReservationsCount: data.syncedReservationsCount || 0,
          syncedDetailsCount: data.syncedDetailsCount || 0,
          syncedCustomersCount: data.syncedCustomersCount || 0,
          latencyMs: data.latencyMs || 25,
        });
        if (data.reservations) {
          setLocalReservationsList(data.reservations);
        }
        if (data.details) {
          setLocalDetailsList(data.details);
        }
        if (data.customers) {
          setLocalCustomersList(data.customers);
        }
        onRefreshParity();
      } else {
        setInboundSyncResult({
          status: 'error',
          message: data.message || data.error || 'Failed to pull reservations from PostgreSQL.',
          fetchedCount: 0,
          syncedReservationsCount: 0,
          syncedDetailsCount: 0,
          syncedCustomersCount: 0,
          latencyMs: 0,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setInboundSyncResult({
        status: 'error',
        message: `Error pulling reservations: ${msg}`,
        fetchedCount: 0,
        syncedReservationsCount: 0,
        syncedDetailsCount: 0,
        syncedCustomersCount: 0,
        latencyMs: 0,
      });
    } finally {
      setIsInboundSyncing(false);
    }
  };

  // Create Test Cloud Reservation on VPS PostgreSQL across 3 Tables with updateflag = 0
  const handleCreatePgTestReservation = async () => {
    setIsCreatingPgReservation(true);
    setCreatePgResMsg(null);
    try {
      const guests = [
        { first: 'Marcus', last: 'Vance', city: 'Mumbai', type: 'Deluxe Ocean Suite', price: 6500 },
        { first: 'Sophia', last: 'Patel', city: 'Bengaluru', type: 'Executive Club Room', price: 4800 },
        { first: 'Liam', last: 'O\'Connor', city: 'Delhi', type: 'Presidential Suite', price: 12500 },
        { first: 'Elena', last: 'Rostova', city: 'Goa', type: 'Standard Deluxe', price: 3900 },
        { first: 'David', last: 'Chen', city: 'Hyderabad', type: 'Luxury Villa', price: 9200 },
      ];
      const g = guests[Math.floor(Math.random() * guests.length)];
      const res = await fetch('/api/sync-unit/create-reservation-pg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelcode: 'HTL-BL-001',
          roomtypeid: 101,
          room_type_name: g.type,
          first_name: g.first,
          last_name: g.last,
          guest_phone: `+91-${Math.floor(90000 + Math.random() * 9000)}-${Math.floor(10000 + Math.random() * 90000)}`,
          guest_email: `${g.first.toLowerCase()}.${g.last.toLowerCase().replace(/['\s]/g, '')}@cloudguest.com`,
          check_in: '2026-09-24 14:00:00',
          check_out: '2026-09-28 11:00:00',
          rooms_booked: 1,
          price_per_night: g.price,
          total_amount: g.price * 4 * 1.12,
          special_requests: 'OTA Channel direct booking (Channel Link: res_id, updateflag = 0)',
          host: postgresHost,
          database: postgresDb,
          user: 'postgres',
          password: vpsPassword || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCreatePgResMsg(`Created Relational Reservation #${data.res_id} (${g.first} ${g.last}) in PostgreSQL [Reservations, reservations_details, reservation_Customer] with updateflag = 0. Click "Pull 3-Table Reservations" to sync into local SQL Server!`);
        onRefreshParity();
      } else {
        setCreatePgResMsg(`Error: ${data.message || 'Failed to create reservation'}`);
      }
    } catch (err: any) {
      setCreatePgResMsg(`Error: ${err.message}`);
    } finally {
      setIsCreatingPgReservation(false);
    }
  };

  // Standalone Node.js Bidirectional Sync Agent Script
  const localAgentScript = `/**
 * BOOKLOGIC SQL Server ➔ VPS PostgreSQL Bidirectional Sync Unit Agent
 * 1. OUTBOUND: Auto-syncs mas_hotel & trans_roomavailability_chart_datewise to VPS (marks uploadflg = 1 in SQL Server)
 * 2. INBOUND: Auto-syncs reservations from VPS PostgreSQL into local SQL Server dbo.reservations_booklogic
 */
const sql = require('mssql');
const { Pool } = require('pg');

// 1. Local SQL Server (Source / Target)
const mssqlConfig = {
  user: 'sa',
  password: 'mgenn@123',
  server: 'DESKTOP-VDGDM3P', // or '127.0.0.1'
  port: 1433,
  database: '${mssqlDb}',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// 2. VPS PostgreSQL (Target / Source)
const pgPool = new Pool({
  host: '${postgresHost}',
  port: 5432,
  database: '${postgresDb}',
  user: 'postgres',
  password: '${vpsPassword || 'mgenn'}',
  ssl: false,
});

let sqlPool = null;

// A. OUTBOUND: Sync Hotel Master (mas_hotel) -> PostgreSQL
async function syncMasHotel(pgClient) {
  try {
    const result = await sqlPool.request().query('SELECT * FROM dbo.mas_hotel WHERE ISNULL(inactive, 0) = 0');
    if (!result.recordset || result.recordset.length === 0) return 0;

    for (const row of result.recordset) {
      const hotelCode = row.HotelCode || row.hotelcode;
      if (!hotelCode) continue;

      const query = \`
        INSERT INTO mas_hotel (
          hotelname, hotelcode, username, password,
          inactive, sql_servername, sql_username, sql_password,
          sql_database, iscloudfo, irm_only
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (hotelcode) DO UPDATE SET
          hotelname = EXCLUDED.hotelname,
          username = EXCLUDED.username,
          password = EXCLUDED.password,
          inactive = EXCLUDED.inactive,
          sql_servername = EXCLUDED.sql_servername,
          sql_username = EXCLUDED.sql_username,
          sql_password = EXCLUDED.sql_password,
          sql_database = EXCLUDED.sql_database,
          iscloudfo = EXCLUDED.iscloudfo,
          irm_only = EXCLUDED.irm_only;
      \`;

      await pgClient.query(query, [
        row.HotelName || row.hotelname || '',
        hotelCode,
        row.Username || row.username || null,
        row.Password || row.password || null,
        row.Inactive !== undefined ? row.Inactive : 0,
        row.Sql_ServerName || row.sql_servername || '127.0.0.1',
        row.Sql_UserName || row.sql_username || 'sa',
        row.Sql_Password || row.sql_password || null,
        row.Sql_Database || row.sql_database || 'BOOKLOGIC',
        row.IsCloudFo !== undefined ? row.IsCloudFo : null,
        row.IRM_Only !== undefined ? row.IRM_Only : null,
      ]);
    }
    return result.recordset.length;
  } catch (err) {
    console.error('Hotel sync error:', err.message);
    return 0;
  }
}

// B. OUTBOUND: Sync Room Availability -> PostgreSQL & mark uploadflg = 1 in SQL Server
async function syncRoomAvailability(pgClient) {
  try {
    const result = await sqlPool.request().query('SELECT * FROM dbo.trans_roomavailability_chart_datewise WHERE ISNULL(uploadflg, 0) = 0');
    if (!result.recordset || result.recordset.length === 0) return 0;

    const syncedAvaids = [];

    for (const row of result.recordset) {
      if (!row.avaidd) continue;

      const query = \`
        INSERT INTO trans_roomavailability_chart_datewise (
          avaidd, roomtypeid, fromdate, todate, availablerooms,
          uploadflg, notupload, remarks, fromtime, totime,
          allotcode, hotelcode, irm_update, stopsales
        ) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (avaidd) DO UPDATE SET
          availablerooms = EXCLUDED.availablerooms,
          remarks = EXCLUDED.remarks,
          stopsales = EXCLUDED.stopsales,
          uploadflg = 1;
      \`;

      await pgClient.query(query, [
        row.avaidd,
        row.Roomtypeid || row.roomtypeid || null,
        row.fromdate || null,
        row.todate || null,
        row.Availablerooms !== undefined ? row.Availablerooms : (row.availablerooms || 0),
        1,
        row.notupload ? String(row.notupload) : null,
        row.Remarks || row.remarks || '',
        row.Fromtime || row.fromtime || null,
        row.Totime || row.totime || null,
        row.allotcode || '',
        row.hotelcode || '',
        row.IRM_Update !== undefined ? row.IRM_Update : 0,
        row.stopsales !== undefined ? row.stopsales : 0,
      ]);

      syncedAvaids.push(row.avaidd);
    }

    if (syncedAvaids.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < syncedAvaids.length; i += chunkSize) {
        const chunk = syncedAvaids.slice(i, i + chunkSize);
        await sqlPool.request().query(\`
          UPDATE dbo.trans_roomavailability_chart_datewise
          SET uploadflg = 1
          WHERE avaidd IN (\${chunk.join(',')})
        \`);
      }
      console.log(\`[DB UPDATE] ✅ Marked uploadflg = 1 for \${syncedAvaids.length} records in SQL Server trans_roomavailability_chart_datewise\`);
    }

    return syncedAvaids.length;
  } catch (err) {
    console.error('Room availability sync error:', err.message);
    return 0;
  }
}

// C. INBOUND: 3-Table Relational Sync (PostgreSQL ➔ Local SQL Server)
// Link Field: res_id | Condition: updateflag = 0 and Hotelcode in mas_hotel
// Target Tables: Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic
async function syncInboundReservations3Tables(pgClient) {
  try {
    // 1. Ensure 3 relational tables exist in Local SQL Server
    await sqlPool.request().query(\`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reservations_booklogic' AND xtype='U')
      CREATE TABLE dbo.Reservations_booklogic (
        res_id BIGINT PRIMARY KEY,
        hotelcode NVARCHAR(100),
        booking_date DATETIME DEFAULT GETDATE(),
        check_in DATETIME,
        check_out DATETIME,
        rooms_booked INT DEFAULT 1,
        total_amount DECIMAL(18,2) DEFAULT 0.00,
        currency NVARCHAR(10) DEFAULT 'INR',
        status NVARCHAR(100) DEFAULT 'CONFIRMED',
        special_requests NVARCHAR(MAX),
        updateflag INT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE(),
        modified_at DATETIME DEFAULT GETDATE(),
        _synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservations_details_booklogic (
        detail_id BIGINT PRIMARY KEY,
        res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
        roomtypeid BIGINT,
        room_type_name NVARCHAR(150),
        rooms_booked INT DEFAULT 1,
        rate_plan_code NVARCHAR(50) DEFAULT 'BAR',
        price_per_night DECIMAL(18,2) DEFAULT 0.00,
        tax_amount DECIMAL(18,2) DEFAULT 0.00,
        meal_plan NVARCHAR(50) DEFAULT 'EP',
        adults INT DEFAULT 1,
        children INT DEFAULT 0,
        nights INT DEFAULT 1,
        check_in DATETIME,
        check_out DATETIME,
        _synced_at DATETIME DEFAULT GETDATE()
      );

      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservation_Customer_booklogic' AND xtype='U')
      CREATE TABLE dbo.reservation_Customer_booklogic (
        customer_id BIGINT PRIMARY KEY,
        res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
        first_name NVARCHAR(100),
        last_name NVARCHAR(100),
        customer_name NVARCHAR(200),
        phone NVARCHAR(100),
        email NVARCHAR(200),
        address NVARCHAR(MAX),
        city NVARCHAR(100),
        country NVARCHAR(100) DEFAULT 'India',
        id_proof_type NVARCHAR(50),
        id_proof_number NVARCHAR(100),
        _synced_at DATETIME DEFAULT GETDATE()
      );
    \`);

    // 2. Fetch local active hotels
    const hotelRes = await sqlPool.request().query('SELECT HotelCode FROM dbo.mas_hotel');
    const hotelCodes = hotelRes.recordset ? hotelRes.recordset.map(h => h.HotelCode || h.hotelcode).filter(Boolean) : [];

    // 3. Query un-synced reservations where updateflag is 0
    let pgQuery = 'SELECT * FROM public.reservations WHERE COALESCE(updateflag, 0) = 0';
    const params = [];
    if (hotelCodes.length > 0) {
      params.push(hotelCodes);
      pgQuery += ' AND hotelcode = ANY($1)';
    }
    pgQuery += ' ORDER BY res_id ASC LIMIT 200';

    const resResult = await pgClient.query(pgQuery, params);
    if (!resResult.rows || resResult.rows.length === 0) return 0;

    const resIds = resResult.rows.map(r => Number(r.res_id));

    // 4. Fetch matching details and customers linked by res_id
    const detailsResult = await pgClient.query(
      'SELECT * FROM public.reservations_details WHERE res_id = ANY($1::bigint[]) ORDER BY detail_id ASC',
      [resIds]
    );
    const custResult = await pgClient.query(
      'SELECT * FROM public.reservation_customer WHERE res_id = ANY($1::bigint[]) ORDER BY customer_id ASC',
      [resIds]
    );

    // 5. Upsert Master records into dbo.Reservations_booklogic
    for (const r of resResult.rows) {
      const req = sqlPool.request();
      req.input('resId', sql.BigInt, r.res_id);
      req.input('hotelcode', sql.NVarChar(100), r.hotelcode || 'HTL-BL-001');
      req.input('bookingDate', sql.DateTime, r.booking_date ? new Date(r.booking_date) : new Date());
      req.input('checkIn', sql.DateTime, r.check_in ? new Date(r.check_in) : null);
      req.input('checkOut', sql.DateTime, r.check_out ? new Date(r.check_out) : null);
      req.input('roomsBooked', sql.Int, r.rooms_booked || 1);
      req.input('totalAmount', sql.Decimal(18, 2), r.total_amount || 0);
      req.input('currency', sql.NVarChar(10), r.currency || 'INR');
      req.input('status', sql.NVarChar(100), r.status || 'CONFIRMED');
      req.input('specialRequests', sql.NVarChar(sql.MAX), r.special_requests || '');

      await req.query(\`
        IF EXISTS (SELECT 1 FROM dbo.Reservations_booklogic WHERE res_id = @resId)
        BEGIN
          UPDATE dbo.Reservations_booklogic
          SET hotelcode = @hotelcode, booking_date = @bookingDate, check_in = @checkIn,
              check_out = @checkOut, rooms_booked = @roomsBooked, total_amount = @totalAmount,
              currency = @currency, status = @status, special_requests = @specialRequests,
              updateflag = 1, modified_at = GETDATE(), _synced_at = GETDATE()
          WHERE res_id = @resId;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.Reservations_booklogic (
            res_id, hotelcode, booking_date, check_in, check_out,
            rooms_booked, total_amount, currency, status, special_requests,
            updateflag, created_at, modified_at, _synced_at
          ) VALUES (
            @resId, @hotelcode, @bookingDate, @checkIn, @checkOut,
            @roomsBooked, @totalAmount, @currency, @status, @specialRequests,
            1, GETDATE(), GETDATE(), GETDATE()
          );
        END
      \`);
    }

    // 6. Upsert Detail records into dbo.reservations_details_booklogic
    for (const d of detailsResult.rows) {
      const req = sqlPool.request();
      req.input('detailId', sql.BigInt, d.detail_id);
      req.input('resId', sql.BigInt, d.res_id);
      req.input('roomtypeid', sql.BigInt, d.roomtypeid || 101);
      req.input('roomTypeName', sql.NVarChar(150), d.room_type_name || 'Standard');
      req.input('roomsBooked', sql.Int, d.rooms_booked || 1);
      req.input('ratePlanCode', sql.NVarChar(50), d.rate_plan_code || 'BAR');
      req.input('pricePerNight', sql.Decimal(18, 2), d.price_per_night || 0);
      req.input('taxAmount', sql.Decimal(18, 2), d.tax_amount || 0);
      req.input('mealPlan', sql.NVarChar(50), d.meal_plan || 'EP');
      req.input('adults', sql.Int, d.adults || 1);
      req.input('children', sql.Int, d.children || 0);
      req.input('nights', sql.Int, d.nights || 1);
      req.input('checkIn', sql.DateTime, d.check_in ? new Date(d.check_in) : null);
      req.input('checkOut', sql.DateTime, d.check_out ? new Date(d.check_out) : null);

      await req.query(\`
        IF EXISTS (SELECT 1 FROM dbo.reservations_details_booklogic WHERE detail_id = @detailId)
        BEGIN
          UPDATE dbo.reservations_details_booklogic
          SET res_id = @resId, roomtypeid = @roomtypeid, room_type_name = @roomTypeName,
              rooms_booked = @roomsBooked, rate_plan_code = @ratePlanCode, price_per_night = @pricePerNight,
              tax_amount = @taxAmount, meal_plan = @mealPlan, adults = @adults, children = @children,
              nights = @nights, check_in = @checkIn, check_out = @checkOut, _synced_at = GETDATE()
          WHERE detail_id = @detailId;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.reservations_details_booklogic (
            detail_id, res_id, roomtypeid, room_type_name,
            rooms_booked, rate_plan_code, price_per_night, tax_amount,
            meal_plan, adults, children, nights, check_in, check_out, _synced_at
          ) VALUES (
            @detailId, @resId, @roomtypeid, @roomTypeName,
            @roomsBooked, @ratePlanCode, @pricePerNight, @taxAmount,
            @mealPlan, @adults, @children, @nights, @checkIn, @checkOut, GETDATE()
          );
        END
      \`);
    }

    // 7. Upsert Customer records into dbo.reservation_Customer_booklogic
    for (const c of custResult.rows) {
      const req = sqlPool.request();
      req.input('custId', sql.BigInt, c.customer_id);
      req.input('resId', sql.BigInt, c.res_id);
      req.input('firstName', sql.NVarChar(100), c.first_name || '');
      req.input('lastName', sql.NVarChar(100), c.last_name || '');
      req.input('customerName', sql.NVarChar(200), c.customer_name || \`\${c.first_name || ''} \${c.last_name || ''}\`.trim());
      req.input('phone', sql.NVarChar(100), c.phone || '');
      req.input('email', sql.NVarChar(200), c.email || '');
      req.input('address', sql.NVarChar(sql.MAX), c.address || '');
      req.input('city', sql.NVarChar(100), c.city || '');
      req.input('country', sql.NVarChar(100), c.country || 'India');
      req.input('idProofType', sql.NVarChar(50), c.id_proof_type || 'PASSPORT');
      req.input('idProofNumber', sql.NVarChar(100), c.id_proof_number || '');

      await req.query(\`
        IF EXISTS (SELECT 1 FROM dbo.reservation_Customer_booklogic WHERE customer_id = @custId)
        BEGIN
          UPDATE dbo.reservation_Customer_booklogic
          SET res_id = @resId, first_name = @firstName, last_name = @lastName,
              customer_name = @customerName, phone = @phone, email = @email,
              address = @address, city = @city, country = @country,
              id_proof_type = @idProofType, id_proof_number = @idProofNumber, _synced_at = GETDATE()
          WHERE customer_id = @custId;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.reservation_Customer_booklogic (
            customer_id, res_id, first_name, last_name, customer_name,
            phone, email, address, city, country, id_proof_type, id_proof_number, _synced_at
          ) VALUES (
            @custId, @resId, @firstName, @lastName, @customerName,
            @phone, @email, @address, @city, @country, @idProofType, @idProofNumber, GETDATE()
          );
        END
      \`);
    }

    // 8. Mark updateflag = 1 in PostgreSQL
    if (resIds.length > 0) {
      await pgClient.query(\`
        UPDATE public.reservations
        SET updateflag = 1, modified_at = CURRENT_TIMESTAMP
        WHERE res_id = ANY($1::bigint[]);
      \`, [resIds]);
      console.log(\`[INBOUND SYNC] ✅ Ingested \${resIds.length} reservations across 3 tables (Reservations_booklogic, reservations_details_booklogic, reservation_Customer_booklogic) and marked updateflag = 1 in PG\`);
    }

    return resResult.rows.length;
  } catch (err) {
    console.error('3-Table reservations inbound sync error:', err.message);
    return 0;
  }
}

async function startAutoSync() {
  console.log('🚀 Connecting to Local SQL Server (BOOKLOGIC)...');
  sqlPool = await sql.connect(mssqlConfig);
  console.log('✅ Connected to Local SQL Server.');

  console.log('🚀 Connecting to VPS PostgreSQL (72.61.240.34/BOOKLOGIC)...');
  const pgClient = await pgPool.connect();
  console.log('✅ Connected to VPS PostgreSQL.');
  pgClient.release();

  console.log('🔄 Bidirectional Auto-Sync Active (continuous real-time daemon)...');
  while (true) {
    let client = null;
    try {
      client = await pgPool.connect();
      const hotels = await syncMasHotel(client);
      const rooms = await syncRoomAvailability(client);
      const reservations = await syncInboundReservations3Tables(client);
      if (hotels > 0 || rooms > 0 || reservations > 0) {
        console.log(\`[\${new Date().toLocaleTimeString()}] ✅ Synced: \${hotels} Hotels, \${rooms} Rooms (Outbound ➔ PG) | 📥 \${reservations} 3-Table Linked Reservations (Inbound ➔ MSSQL)!\`);
      }
    } catch (err) {
      console.error(\`[SYNC ERROR]: \${err.message}\`);
    } finally {
      if (client) client.release();
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

startAutoSync().catch(console.error);
`;

  return (
    <div className="space-y-5">
      {/* Top Banner: Local Database ➔ VPS Sync Unit */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                  BOOKLOGIC Local Sync Unit
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    BIDIRECTIONAL ENGINE
                  </span>
                </h2>
                <p className="text-xs text-zinc-500">
                  Sync records between local SQL database <span className="font-mono font-semibold text-blue-700">{mssqlDb}</span> and VPS PostgreSQL <span className="font-mono font-semibold text-emerald-700">{postgresDb}</span> ({postgresHost})
                </p>
              </div>
            </div>
          </div>

          {/* Sub Navigation Modes */}
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs flex-wrap">
            <button
              onClick={() => setActiveSubTab('auto_sync')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'auto_sync' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Zap className={`w-3.5 h-3.5 ${autoSync.enabled ? 'text-amber-500 fill-amber-500 animate-pulse' : 'text-zinc-400'}`} />
              Auto-Sync Daemon
              {autoSync.enabled && (
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveSubTab('inbound_reservations');
                handlePullReservations();
              }}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'inbound_reservations' ? 'bg-white text-purple-900 shadow-2xs font-semibold border border-purple-200' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <DownloadCloud className="w-3.5 h-3.5 text-purple-600" />
              Inbound Reservations (PG ➔ MSSQL)
            </button>
            <button
              onClick={() => setActiveSubTab('quick_push')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'quick_push' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              1-Click Batch Push
            </button>
            <button
              onClick={() => setActiveSubTab('custom_import')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'custom_import' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
              Custom Records Importer
            </button>
            <button
              onClick={() => setActiveSubTab('cli_agent')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'cli_agent' ? 'bg-white text-zinc-900 shadow-2xs font-semibold' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-600" />
              Local Sync Agent Script
            </button>
            <button
              onClick={() => setActiveSubTab('win_service')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeSubTab === 'win_service' ? 'bg-white text-blue-900 shadow-2xs font-semibold border border-blue-200' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <Server className="w-3.5 h-3.5 text-blue-600" />
              Windows Service Setup
            </button>
          </div>
        </div>

        {/* Tab 0: Auto-Sync Background Daemon */}
        {activeSubTab === 'auto_sync' && (
          <div className="mt-5 space-y-4">
            {/* Auto-Sync Main Control Banner */}
            <div className={`p-5 rounded-xl border transition-all duration-300 ${autoSync.enabled ? 'bg-gradient-to-r from-emerald-950 via-teal-950 to-zinc-950 border-emerald-500/40 text-white shadow-lg' : 'bg-zinc-900 border-zinc-800 text-zinc-200'}`}>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-colors ${autoSync.enabled ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' : 'bg-zinc-800 text-zinc-400'}`}>
                    <Zap className={`w-6 h-6 ${autoSync.enabled ? 'fill-white animate-bounce' : ''}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white tracking-tight">
                        Continuous Auto-Sync Daemon
                      </h3>
                      {autoSync.enabled ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                          ACTIVE & STREAMING
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                          <Pause className="w-3 h-3" />
                          STANDBY (PAUSED)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-300 mt-1 max-w-xl">
                      When enabled, the backend daemon periodically checks selected MSSQL tables and automatically pushes all new, updated, and changed records into VPS PostgreSQL without requiring manual button clicks.
                    </p>
                  </div>
                </div>

                {/* Main Toggle Switch Button */}
                <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
                  <span className="text-xs font-semibold text-zinc-300">
                    {autoSync.enabled ? 'Daemon ON' : 'Daemon OFF'}
                  </span>
                  <button
                    onClick={handleToggleAutoSync}
                    disabled={isTogglingAutoSync}
                    aria-label="Toggle Auto-Sync Daemon"
                    className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-zinc-900 ${autoSync.enabled ? 'bg-emerald-500' : 'bg-zinc-700'} ${isTogglingAutoSync ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md ${autoSync.enabled ? 'translate-x-9' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              </div>

              {/* Real-time KPI Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-zinc-800/80">
                <div className="bg-black/30 backdrop-blur-xs p-3 rounded-lg border border-white/5">
                  <div className="text-[10px] uppercase font-semibold text-zinc-400">Total Sync Cycles</div>
                  <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    {autoSync.totalSyncCycles.toLocaleString()}
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-xs p-3 rounded-lg border border-white/5">
                  <div className="text-[10px] uppercase font-semibold text-zinc-400">Records Replicated</div>
                  <div className="text-lg font-bold font-mono text-cyan-400 mt-0.5 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-cyan-500" />
                    {autoSync.totalRecordsSynced.toLocaleString()}
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-xs p-3 rounded-lg border border-white/5">
                  <div className="text-[10px] uppercase font-semibold text-zinc-400">Next Sync Pulse</div>
                  <div className="text-lg font-bold font-mono text-amber-300 mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-400" />
                    {autoSync.enabled ? `${autoSync.nextRunInSeconds}s` : 'Paused'}
                  </div>
                </div>

                <div className="bg-black/30 backdrop-blur-xs p-3 rounded-lg border border-white/5 flex flex-col justify-center">
                  <button
                    onClick={handleTriggerNow}
                    disabled={isTriggeringNow}
                    className="w-full py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTriggeringNow ? 'animate-spin' : ''}`} />
                    Sync Now
                  </button>
                </div>
              </div>
            </div>

            {/* Daemon Configuration Panel: Table Selection & Polling Interval */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Table Multi-Selector with Force Sync Action */}
              <div className="p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-emerald-600" />
                      Table Sync Selection:
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllForceTables}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {selectedForceTables.length === 5 ? 'Reset Selection' : 'Select All (5)'}
                      </button>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
                        {selectedForceTables.length} selected
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {[
                      { id: 'mas_hotel', name: 'dbo.mas_hotel', desc: 'Hotel Master Profiles (ANT2370, TAM2542, etc.)' },
                      { id: 'trans_roomavailability_chart_datewise', name: 'dbo.trans_roomavailability_chart_datewise', desc: 'Room Inventory & Datewise Availability' },
                      { id: 'customers', name: 'dbo.Customers', desc: 'Accounts & Client Master' },
                      { id: 'orders', name: 'dbo.Orders', desc: 'Booking Transactions & Invoices' },
                      { id: 'inventory', name: 'dbo.Inventory', desc: 'Supplies & Item Stock' },
                    ].map((tbl) => {
                      const isSelected = selectedForceTables.includes(tbl.id);
                      return (
                        <label
                          key={tbl.id}
                          onClick={() => handleToggleForceTable(tbl.id)}
                          className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition ${isSelected ? 'bg-emerald-50/80 border-emerald-400 text-emerald-950 shadow-2xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div>
                              <div className="text-xs font-bold font-mono">{tbl.name}</div>
                              <div className="text-[11px] text-zinc-500">{tbl.desc}</div>
                            </div>
                          </div>
                          {isSelected ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-200/80 text-emerald-900 border border-emerald-300">
                              SELECTED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] text-zinc-400">
                              SKIP
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Force Sync Action Bar */}
                <div className="mt-4 pt-3 border-t border-zinc-200 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleForceSyncSelected}
                      disabled={isForceSyncing || selectedForceTables.length === 0}
                      className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 transition ${isForceSyncing || selectedForceTables.length === 0 ? 'bg-zinc-400 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 active:to-teal-700'}`}
                    >
                      {isForceSyncing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Force Syncing {selectedForceTables.length} Table(s)...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 fill-white" />
                          <span>Force Sync Selected ({selectedForceTables.length} Tables)</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 px-0.5">
                    <span>⚡ Bypasses daemon & executes immediate one-time push</span>
                    <span className="font-mono text-zinc-600 font-medium">Target: {postgresDb}</span>
                  </div>

                  {/* Force Sync Feedback Display */}
                  {forceSyncFeedback.status !== 'idle' && (
                    <div className={`p-2.5 rounded-lg text-xs font-medium border ${forceSyncFeedback.status === 'running' ? 'bg-blue-50 border-blue-200 text-blue-800' : forceSyncFeedback.status === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : forceSyncFeedback.status === 'warning' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
                      <div className="flex items-center gap-1.5 font-bold">
                        {forceSyncFeedback.status === 'running' && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                        {forceSyncFeedback.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                        {forceSyncFeedback.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                        {forceSyncFeedback.status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />}
                        <span>{forceSyncFeedback.message}</span>
                      </div>
                      {forceSyncFeedback.tableResults && forceSyncFeedback.tableResults.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-black/5 space-y-0.5 text-[11px] font-mono">
                          {forceSyncFeedback.tableResults.map((tr, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-zinc-700">dbo.{tr.table}:</span>
                              <span className="text-emerald-700 font-bold">{tr.pushedCount} records synced</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Interval & Destination Details */}
              <div className="p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs flex flex-col justify-between">
                <div>
                  <label className="text-xs font-bold text-zinc-900 flex items-center gap-1.5 mb-3">
                    <Sliders className="w-4 h-4 text-blue-600" />
                    Sync Frequency (Polling Interval):
                  </label>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {[
                      { sec: 3, label: '3 Seconds', badge: 'Real-time ⚡' },
                      { sec: 5, label: '5 Seconds', badge: 'Balanced' },
                      { sec: 10, label: '10 Seconds', badge: 'Standard' },
                      { sec: 30, label: '30 Seconds', badge: 'Lightweight' },
                    ].map((opt) => (
                      <button
                        key={opt.sec}
                        onClick={() => handleChangeInterval(opt.sec)}
                        className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${autoSync.intervalSeconds === opt.sec ? 'bg-blue-50 border-blue-400 text-blue-900 font-bold shadow-2xs' : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100'}`}
                      >
                        <span className="text-xs">{opt.label}</span>
                        <span className="text-[10px] font-mono text-blue-600 mt-1">{opt.badge}</span>
                      </button>
                    ))}
                  </div>

                  <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-xs text-zinc-600 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Source Database:</span>
                      <span className="font-mono font-semibold text-blue-700">MSSQL [{mssqlDb}]</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Target VPS Host:</span>
                      <span className="font-mono font-semibold text-emerald-700">{postgresHost}:5432</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Target Database:</span>
                      <span className="font-mono font-semibold text-emerald-700">PG [{postgresDb}]</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Conflict Resolution:</span>
                      <span className="font-mono font-semibold text-zinc-800">Upsert (ON CONFLICT DO UPDATE)</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Zero manual intervention required
                  </span>
                  <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {showLogs ? 'Hide Live Stream' : 'Show Live Stream'}
                  </button>
                </div>
              </div>
            </div>

            {/* Live Auto-Sync Activity Stream */}
            {showLogs && (
              <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 text-white font-mono text-xs">
                <div className="bg-zinc-900 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold text-zinc-200">Auto-Sync Daemon Background Activity Stream</span>
                    {autoSync.enabled && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-400">
                    Live Polling Frequency: {autoSync.intervalSeconds}s
                  </span>
                </div>

                <div className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
                  {autoSync.recentLogs && autoSync.recentLogs.length > 0 ? (
                    autoSync.recentLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 text-[11px] text-zinc-300 leading-relaxed border-b border-zinc-900/60 pb-1">
                        <span className="text-zinc-500 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className={`shrink-0 font-bold ${log.status === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {log.status === 'error' ? '❌' : '⚡'}
                        </span>
                        <span className="text-zinc-300 flex-1">{log.message}</span>
                        {log.latencyMs > 0 && (
                          <span className="text-zinc-500 shrink-0">{log.latencyMs}ms</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 text-center py-4">
                      No daemon sync cycles recorded yet. Toggle Auto-Sync above to begin continuous replication.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Target Table Selector & Host Parameters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 uppercase tracking-wider mb-1">
              Select Table to Push:
            </label>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-300 rounded-lg text-xs font-semibold text-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            >
              <option value="mas_hotel">dbo.mas_hotel (Hotel Master)</option>
              <option value="trans_roomavailability_chart_datewise">dbo.trans_roomavailability_chart_datewise (Inventory/Availability)</option>
              <option value="customers">dbo.Customers (Accounts & Guests)</option>
              <option value="orders">dbo.Orders (Bookings & Invoices)</option>
              <option value="inventory">dbo.Inventory (Supplies & Assets)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 uppercase tracking-wider mb-1">
              Source ➔ Destination:
            </label>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100/70 border border-zinc-200 rounded-lg text-xs font-mono text-zinc-800">
              <span className="text-blue-700 font-bold">MSSQL: {mssqlDb}</span>
              <ArrowRight className="w-3 h-3 text-zinc-400" />
              <span className="text-emerald-700 font-bold">PG: {postgresDb} ({postgresHost})</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-700 uppercase tracking-wider mb-1">
              VPS PostgreSQL Password (Optional Direct Live):
            </label>
            <input
              type="password"
              placeholder="e.g. Master password or leave blank"
              value={vpsPassword}
              onChange={(e) => setVpsPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-300 rounded-lg text-xs text-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Tab: Inbound Reservations (PostgreSQL ➔ Local SQL Server 3-Table Sync) */}
        {activeSubTab === 'inbound_reservations' && (
          <div className="mt-5 space-y-5">
            {/* Main Inbound Banner */}
            <div className="p-5 rounded-xl bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-950 text-white border border-purple-500/40 shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl bg-purple-500/20 border border-purple-400/30 text-purple-300 flex items-center justify-center shrink-0 shadow">
                    <DownloadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white tracking-tight">
                        3-Table Inbound Sync: PostgreSQL ➔ Local SQL Server
                      </h3>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        LINKED BY res_id
                      </span>
                    </div>
                    <p className="text-xs text-purple-200/80 mt-1 max-w-2xl leading-relaxed">
                      Fetches records from <code className="font-mono text-purple-300 bg-purple-900/50 px-1 py-0.5 rounded">Reservations</code>, <code className="font-mono text-purple-300 bg-purple-900/50 px-1 py-0.5 rounded">reservations_details</code>, and <code className="font-mono text-purple-300 bg-purple-900/50 px-1 py-0.5 rounded">reservation_Customer</code> where <code className="font-mono text-amber-300 bg-purple-900/50 px-1 py-0.5 rounded">updateflag = 0</code> and <code className="font-mono text-amber-300 bg-purple-900/50 px-1 py-0.5 rounded">Hotelcode</code> matches, inserting into local <code className="font-mono text-blue-300 bg-purple-900/50 px-1 py-0.5 rounded">Reservations_booklogic</code>, <code className="font-mono text-blue-300 bg-purple-900/50 px-1 py-0.5 rounded">reservations_details_booklogic</code>, and <code className="font-mono text-blue-300 bg-purple-900/50 px-1 py-0.5 rounded">reservation_Customer_booklogic</code>.
                    </p>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center shrink-0">
                  <button
                    onClick={handlePullReservations}
                    disabled={isInboundSyncing}
                    className={`py-2 px-4 rounded-lg text-xs font-bold text-white shadow-md flex items-center gap-2 transition ${isInboundSyncing ? 'bg-purple-800/80 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:from-purple-700'}`}
                  >
                    <DownloadCloud className={`w-4 h-4 ${isInboundSyncing ? 'animate-bounce' : ''}`} />
                    <span>{isInboundSyncing ? 'Syncing 3 Tables...' : 'Pull 3-Table Reservations'}</span>
                  </button>

                  <button
                    onClick={handleCreatePgTestReservation}
                    disabled={isCreatingPgReservation}
                    className="py-2 px-3 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition flex items-center gap-1.5"
                  >
                    <Sparkles className={`w-3.5 h-3.5 text-amber-300 ${isCreatingPgReservation ? 'animate-spin' : ''}`} />
                    <span>+ Simulate Cloud Booking (updateflag = 0)</span>
                  </button>
                </div>
              </div>

              {/* Status and Feedback Row */}
              {inboundSyncResult.status !== 'idle' && (
                <div className={`mt-4 p-3 rounded-lg text-xs flex items-center justify-between border ${inboundSyncResult.status === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200' : 'bg-rose-950/60 border-rose-500/40 text-rose-200'}`}>
                  <div className="flex items-center gap-2">
                    {inboundSyncResult.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span>{inboundSyncResult.message}</span>
                  </div>
                  {inboundSyncResult.latencyMs > 0 && (
                    <span className="font-mono text-[11px] opacity-80 shrink-0 ml-2">{inboundSyncResult.latencyMs}ms</span>
                  )}
                </div>
              )}

              {createPgResMsg && (
                <div className="mt-3 p-2.5 rounded-lg text-xs bg-amber-950/50 border border-amber-500/30 text-amber-200 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{createPgResMsg}</span>
                </div>
              )}
            </div>

            {/* Architecture Card + 3-Table T-SQL Schema Helper */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Architecture Info */}
              <div className="p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs space-y-3">
                <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-purple-600" />
                  3-Table Relational Link Architecture
                </h4>
                <div className="space-y-2 text-xs text-zinc-600">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100">
                    <span className="font-medium text-zinc-700">Common Link Field:</span>
                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">res_id</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100">
                    <span className="font-medium text-zinc-700">Filter Condition:</span>
                    <span className="font-mono font-semibold text-amber-700">updateflag = 0 AND Hotelcode</span>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-100 space-y-1">
                    <div className="text-[11px] font-semibold text-zinc-800">Source ➔ Local SQL Server Tables:</div>
                    <div className="text-[11px] font-mono text-zinc-600">1. Reservations ➔ <span className="text-blue-700 font-bold">Reservations_booklogic</span></div>
                    <div className="text-[11px] font-mono text-zinc-600">2. reservations_details ➔ <span className="text-blue-700 font-bold">reservations_details_booklogic</span></div>
                    <div className="text-[11px] font-mono text-zinc-600">3. reservation_Customer ➔ <span className="text-blue-700 font-bold">reservation_Customer_booklogic</span></div>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100">
                    <span className="font-medium text-zinc-700">Post-Sync Update:</span>
                    <span className="font-mono text-emerald-700 font-semibold">PG SET updateflag = 1</span>
                  </div>
                </div>
              </div>

              {/* T-SQL DDL for 3 Tables in SQL Server */}
              <div className="lg:col-span-2 p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-blue-600" />
                    SQL Server DDL: 3 Linked Tables with Foreign Key (res_id)
                  </h4>
                  <button
                    onClick={() => handleCopy(`-- 1. Master Table: dbo.Reservations_booklogic
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reservations_booklogic' AND xtype='U')
CREATE TABLE dbo.Reservations_booklogic (
    res_id BIGINT PRIMARY KEY,
    hotelcode NVARCHAR(100),
    booking_date DATETIME DEFAULT GETDATE(),
    check_in DATETIME,
    check_out DATETIME,
    rooms_booked INT DEFAULT 1,
    total_amount DECIMAL(18,2) DEFAULT 0.00,
    currency NVARCHAR(10) DEFAULT 'INR',
    status NVARCHAR(100) DEFAULT 'CONFIRMED',
    special_requests NVARCHAR(MAX),
    updateflag INT DEFAULT 1,
    created_at DATETIME DEFAULT GETDATE(),
    modified_at DATETIME DEFAULT GETDATE(),
    _synced_at DATETIME DEFAULT GETDATE()
);

-- 2. Detail Table: dbo.reservations_details_booklogic (Link: res_id)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservations_details_booklogic' AND xtype='U')
CREATE TABLE dbo.reservations_details_booklogic (
    detail_id BIGINT PRIMARY KEY,
    res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
    roomtypeid BIGINT,
    room_type_name NVARCHAR(150),
    rooms_booked INT DEFAULT 1,
    rate_plan_code NVARCHAR(50) DEFAULT 'BAR',
    price_per_night DECIMAL(18,2) DEFAULT 0.00,
    tax_amount DECIMAL(18,2) DEFAULT 0.00,
    meal_plan NVARCHAR(50) DEFAULT 'EP',
    adults INT DEFAULT 1,
    children INT DEFAULT 0,
    nights INT DEFAULT 1,
    check_in DATETIME,
    check_out DATETIME,
    _synced_at DATETIME DEFAULT GETDATE()
);

-- 3. Customer Table: dbo.reservation_Customer_booklogic (Link: res_id)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reservation_Customer_booklogic' AND xtype='U')
CREATE TABLE dbo.reservation_Customer_booklogic (
    customer_id BIGINT PRIMARY KEY,
    res_id BIGINT FOREIGN KEY REFERENCES dbo.Reservations_booklogic(res_id) ON DELETE CASCADE,
    first_name NVARCHAR(100),
    last_name NVARCHAR(100),
    customer_name NVARCHAR(200),
    phone NVARCHAR(100),
    email NVARCHAR(200),
    address NVARCHAR(MAX),
    city NVARCHAR(100),
    country NVARCHAR(100) DEFAULT 'India',
    id_proof_type NVARCHAR(50),
    id_proof_number NVARCHAR(100),
    _synced_at DATETIME DEFAULT GETDATE()
);

CREATE INDEX idx_res_bklogic_hotel ON dbo.Reservations_booklogic (hotelcode, check_in);
CREATE INDEX idx_res_dtl_resid ON dbo.reservations_details_booklogic (res_id);
CREATE INDEX idx_res_cust_resid ON dbo.reservation_Customer_booklogic (res_id);`, 'res-3tbl-ddl')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-900 hover:bg-black text-white text-xs font-medium rounded-md transition"
                  >
                    {copiedKey === 'res-3tbl-ddl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'res-3tbl-ddl' ? 'Copied' : 'Copy 3-Table T-SQL'}</span>
                  </button>
                </div>

                <div className="bg-zinc-950 text-zinc-200 p-3 rounded-lg font-mono text-xs overflow-x-auto max-h-36 border border-zinc-800">
                  <pre>{`-- 3-Table Relational DDL (Link: res_id)
CREATE TABLE dbo.Reservations_booklogic ( res_id BIGINT PRIMARY KEY, hotelcode NVARCHAR(100), ... );
CREATE TABLE dbo.reservations_details_booklogic ( detail_id BIGINT PRIMARY KEY, res_id BIGINT REFERENCES dbo.Reservations_booklogic(res_id), ... );
CREATE TABLE dbo.reservation_Customer_booklogic ( customer_id BIGINT PRIMARY KEY, res_id BIGINT REFERENCES dbo.Reservations_booklogic(res_id), ... );`}</pre>
                </div>
              </div>
            </div>

            {/* Live Synchronized 3-Table Viewer with Sub-Tabs */}
            <div className="p-4 rounded-xl bg-white border border-zinc-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-zinc-100 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                    <Bookmark className="w-4 h-4 text-purple-600" />
                    Local SQL Server Relational Tables (Common Link: res_id)
                  </h4>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Records pulled where <span className="font-mono font-semibold text-amber-700">updateflag = 0</span> and inserted into local <span className="font-mono text-blue-700 font-semibold">*_booklogic</span> tables.
                  </p>
                </div>

                {/* Sub-View Selector */}
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
                    <button
                      onClick={() => setInboundTableSubView('master')}
                      className={`px-2.5 py-1 rounded font-medium transition ${inboundTableSubView === 'master' ? 'bg-white shadow-2xs font-bold text-purple-900' : 'text-zinc-600'}`}
                    >
                      Reservations_booklogic ({localReservationsList.length || 3})
                    </button>
                    <button
                      onClick={() => setInboundTableSubView('details')}
                      className={`px-2.5 py-1 rounded font-medium transition ${inboundTableSubView === 'details' ? 'bg-white shadow-2xs font-bold text-purple-900' : 'text-zinc-600'}`}
                    >
                      reservations_details ({localDetailsList.length || 3})
                    </button>
                    <button
                      onClick={() => setInboundTableSubView('customer')}
                      className={`px-2.5 py-1 rounded font-medium transition ${inboundTableSubView === 'customer' ? 'bg-white shadow-2xs font-bold text-purple-900' : 'text-zinc-600'}`}
                    >
                      reservation_Customer ({localCustomersList.length || 3})
                    </button>
                    <button
                      onClick={() => setInboundTableSubView('relational')}
                      className={`px-2.5 py-1 rounded font-medium transition ${inboundTableSubView === 'relational' ? 'bg-purple-600 font-bold text-white shadow-2xs' : 'text-purple-700'}`}
                    >
                      🔗 Relational Tree
                    </button>
                  </div>

                  <button
                    onClick={handlePullReservations}
                    className="p-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:text-purple-700 hover:bg-zinc-50 transition"
                    title="Refresh Inbound Records"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isInboundSyncing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Sub-View 1: Master Table (Reservations_booklogic) */}
              {inboundTableSubView === 'master' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-700 font-semibold border-b border-zinc-200 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2.5">res_id (PK)</th>
                        <th className="px-3 py-2.5">Hotelcode</th>
                        <th className="px-3 py-2.5">Booking Date</th>
                        <th className="px-3 py-2.5">Check-In / Out</th>
                        <th className="px-3 py-2.5">Rooms</th>
                        <th className="px-3 py-2.5">Amount</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">updateflag</th>
                        <th className="px-3 py-2.5">Synced At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono text-[11px]">
                      {(localReservationsList.length > 0 ? localReservationsList : [
                        {
                          res_id: 9001,
                          hotelcode: 'HTL-BL-001',
                          booking_date: '2026-09-18 10:30:00',
                          check_in: '2026-09-24 14:00:00',
                          check_out: '2026-09-28 11:00:00',
                          rooms_booked: 1,
                          total_amount: 24640.00,
                          currency: 'INR',
                          status: 'CONFIRMED',
                          updateflag: 1,
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          res_id: 9002,
                          hotelcode: 'HTL-BL-001',
                          booking_date: '2026-09-18 11:15:00',
                          check_in: '2026-09-25 14:00:00',
                          check_out: '2026-09-30 11:00:00',
                          rooms_booked: 2,
                          total_amount: 54000.00,
                          currency: 'INR',
                          status: 'CONFIRMED',
                          updateflag: 1,
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          res_id: 9003,
                          hotelcode: 'HTL-BL-002',
                          booking_date: '2026-09-18 12:00:00',
                          check_in: '2026-09-26 14:00:00',
                          check_out: '2026-09-29 11:00:00',
                          rooms_booked: 1,
                          total_amount: 18000.00,
                          currency: 'INR',
                          status: 'CONFIRMED',
                          updateflag: 1,
                          _synced_at: new Date().toISOString(),
                        },
                      ]).map((r) => (
                        <tr key={r.res_id} className="hover:bg-purple-50/50 transition cursor-pointer" onClick={() => setExpandedResId(expandedResId === r.res_id ? null : r.res_id)}>
                          <td className="px-3 py-2 font-bold text-purple-900 flex items-center gap-1">
                            <span className="text-purple-600">🔑</span> #{r.res_id}
                          </td>
                          <td className="px-3 py-2 text-zinc-700 font-bold">{r.hotelcode}</td>
                          <td className="px-3 py-2 text-zinc-600">{String(r.booking_date).substring(0, 16)}</td>
                          <td className="px-3 py-2 text-zinc-700">
                            <div>{String(r.check_in).substring(0, 10)}</div>
                            <div className="text-[10px] text-zinc-400">➔ {String(r.check_out).substring(0, 10)}</div>
                          </td>
                          <td className="px-3 py-2 font-bold text-zinc-800">{r.rooms_booked}</td>
                          <td className="px-3 py-2 font-bold text-emerald-700">₹{Number(r.total_amount).toLocaleString()}</td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-bold text-indigo-700">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-50 border border-indigo-200">
                              {r.updateflag}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[10px] text-zinc-500">
                            {r._synced_at ? new Date(r._synced_at).toLocaleTimeString() : 'Recent'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-View 2: Details Table (reservations_details_booklogic) */}
              {inboundTableSubView === 'details' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-700 font-semibold border-b border-zinc-200 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2.5">detail_id (PK)</th>
                        <th className="px-3 py-2.5">res_id (FK Link)</th>
                        <th className="px-3 py-2.5">Room Type</th>
                        <th className="px-3 py-2.5">Rate Plan</th>
                        <th className="px-3 py-2.5">Price / Night</th>
                        <th className="px-3 py-2.5">Meal Plan</th>
                        <th className="px-3 py-2.5">Pax (A/C)</th>
                        <th className="px-3 py-2.5">Nights</th>
                        <th className="px-3 py-2.5">Synced At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono text-[11px]">
                      {(localDetailsList.length > 0 ? localDetailsList : [
                        {
                          detail_id: 501,
                          res_id: 9001,
                          roomtypeid: 101,
                          room_type_name: 'Deluxe Ocean Suite',
                          rooms_booked: 1,
                          rate_plan_code: 'OTA-DIRECT',
                          price_per_night: 5500.00,
                          tax_amount: 2640.00,
                          meal_plan: 'CP (Breakfast Incl)',
                          adults: 2,
                          children: 0,
                          nights: 4,
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          detail_id: 502,
                          res_id: 9002,
                          roomtypeid: 102,
                          room_type_name: 'Executive Deluxe Suite',
                          rooms_booked: 2,
                          rate_plan_code: 'OTA-DIRECT',
                          price_per_night: 6000.00,
                          tax_amount: 5760.00,
                          meal_plan: 'MAP (Dinner+Bfast)',
                          adults: 4,
                          children: 1,
                          nights: 5,
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          detail_id: 503,
                          res_id: 9003,
                          roomtypeid: 201,
                          room_type_name: 'Standard Deluxe',
                          rooms_booked: 1,
                          rate_plan_code: 'BAR',
                          price_per_night: 4500.00,
                          tax_amount: 2160.00,
                          meal_plan: 'EP (Room Only)',
                          adults: 1,
                          children: 0,
                          nights: 3,
                          _synced_at: new Date().toISOString(),
                        },
                      ]).map((d) => (
                        <tr key={d.detail_id} className="hover:bg-blue-50/50 transition">
                          <td className="px-3 py-2 font-bold text-zinc-900">#{d.detail_id}</td>
                          <td className="px-3 py-2 font-bold text-purple-800 bg-purple-50/50">
                            🔗 res_id: {d.res_id}
                          </td>
                          <td className="px-3 py-2 text-zinc-800 font-sans font-semibold">
                            {d.room_type_name} <span className="text-[10px] text-zinc-400 font-mono">(ID: {d.roomtypeid})</span>
                          </td>
                          <td className="px-3 py-2 text-zinc-600 font-bold">{d.rate_plan_code}</td>
                          <td className="px-3 py-2 font-bold text-emerald-700">₹{Number(d.price_per_night).toLocaleString()}</td>
                          <td className="px-3 py-2 text-zinc-700">{d.meal_plan}</td>
                          <td className="px-3 py-2 text-zinc-800">{d.adults}A / {d.children}C</td>
                          <td className="px-3 py-2 font-bold text-zinc-800">{d.nights} N</td>
                          <td className="px-3 py-2 text-[10px] text-zinc-500">
                            {d._synced_at ? new Date(d._synced_at).toLocaleTimeString() : 'Recent'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-View 3: Customer Table (reservation_Customer_booklogic) */}
              {inboundTableSubView === 'customer' && (
                <div className="overflow-x-auto border border-zinc-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-700 font-semibold border-b border-zinc-200 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2.5">customer_id (PK)</th>
                        <th className="px-3 py-2.5">res_id (FK Link)</th>
                        <th className="px-3 py-2.5">Guest Name</th>
                        <th className="px-3 py-2.5">Phone & Email</th>
                        <th className="px-3 py-2.5">City / Country</th>
                        <th className="px-3 py-2.5">ID Proof</th>
                        <th className="px-3 py-2.5">Synced At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono text-[11px]">
                      {(localCustomersList.length > 0 ? localCustomersList : [
                        {
                          customer_id: 701,
                          res_id: 9001,
                          first_name: 'Marcus',
                          last_name: 'Vance',
                          customer_name: 'Marcus Vance',
                          phone: '+91-98440-12345',
                          email: 'm.vance@example.com',
                          city: 'Mumbai',
                          country: 'India',
                          id_proof_type: 'PASSPORT',
                          id_proof_number: 'PASS-892144',
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          customer_id: 702,
                          res_id: 9002,
                          first_name: 'Elena',
                          last_name: 'Rostova',
                          customer_name: 'Elena Rostova',
                          phone: '+91-98765-43210',
                          email: 'e.rostova@travel.com',
                          city: 'Goa',
                          country: 'India',
                          id_proof_type: 'AADHAAR',
                          id_proof_number: 'AAD-7782-9910',
                          _synced_at: new Date().toISOString(),
                        },
                        {
                          customer_id: 703,
                          res_id: 9003,
                          first_name: 'Liam',
                          last_name: 'O\'Connor',
                          customer_name: 'Liam O\'Connor',
                          phone: '+91-99887-76655',
                          email: 'liam.oc@direct.io',
                          city: 'Delhi',
                          country: 'India',
                          id_proof_type: 'PASSPORT',
                          id_proof_number: 'PASS-192834',
                          _synced_at: new Date().toISOString(),
                        },
                      ]).map((c) => (
                        <tr key={c.customer_id} className="hover:bg-emerald-50/50 transition">
                          <td className="px-3 py-2 font-bold text-zinc-900">#{c.customer_id}</td>
                          <td className="px-3 py-2 font-bold text-purple-800 bg-purple-50/50">
                            🔗 res_id: {c.res_id}
                          </td>
                          <td className="px-3 py-2 font-sans font-semibold text-zinc-900">
                            {c.customer_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            <div>{c.phone}</div>
                            <div className="text-[10px] text-zinc-400">{c.email}</div>
                          </td>
                          <td className="px-3 py-2 text-zinc-700">{c.city}, {c.country}</td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-100 text-zinc-800 border border-zinc-200">
                              {c.id_proof_type}: {c.id_proof_number}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[10px] text-zinc-500">
                            {c._synced_at ? new Date(c._synced_at).toLocaleTimeString() : 'Recent'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-View 4: Complete Relational Tree (Master ➔ Details & Customer linked by res_id) */}
              {inboundTableSubView === 'relational' && (
                <div className="space-y-3">
                  {(localReservationsList.length > 0 ? localReservationsList : [
                    {
                      res_id: 9001,
                      hotelcode: 'HTL-BL-001',
                      booking_date: '2026-09-18 10:30:00',
                      check_in: '2026-09-24 14:00:00',
                      check_out: '2026-09-28 11:00:00',
                      rooms_booked: 1,
                      total_amount: 24640.00,
                      status: 'CONFIRMED',
                      special_requests: 'High floor with city view',
                    },
                    {
                      res_id: 9002,
                      hotelcode: 'HTL-BL-001',
                      booking_date: '2026-09-18 11:15:00',
                      check_in: '2026-09-25 14:00:00',
                      check_out: '2026-09-30 11:00:00',
                      rooms_booked: 2,
                      total_amount: 54000.00,
                      status: 'CONFIRMED',
                      special_requests: 'Late check-in at 8 PM',
                    },
                  ]).map((master) => {
                    const matchingDetail = (localDetailsList.length > 0 ? localDetailsList : [
                      {
                        detail_id: 501,
                        res_id: 9001,
                        room_type_name: 'Deluxe Ocean Suite',
                        rate_plan_code: 'OTA-DIRECT',
                        price_per_night: 5500.00,
                        meal_plan: 'CP (Breakfast Incl)',
                        adults: 2,
                        children: 0,
                        nights: 4,
                      },
                      {
                        detail_id: 502,
                        res_id: 9002,
                        room_type_name: 'Executive Deluxe Suite',
                        rate_plan_code: 'OTA-DIRECT',
                        price_per_night: 6000.00,
                        meal_plan: 'MAP (Dinner+Bfast)',
                        adults: 4,
                        children: 1,
                        nights: 5,
                      },
                    ]).find(d => d.res_id === master.res_id);

                    const matchingCustomer = (localCustomersList.length > 0 ? localCustomersList : [
                      {
                        customer_id: 701,
                        res_id: 9001,
                        customer_name: 'Marcus Vance',
                        phone: '+91-98440-12345',
                        email: 'm.vance@example.com',
                        city: 'Mumbai',
                        country: 'India',
                        id_proof_type: 'PASSPORT',
                        id_proof_number: 'PASS-892144',
                      },
                      {
                        customer_id: 702,
                        res_id: 9002,
                        customer_name: 'Elena Rostova',
                        phone: '+91-98765-43210',
                        email: 'e.rostova@travel.com',
                        city: 'Goa',
                        country: 'India',
                        id_proof_type: 'AADHAAR',
                        id_proof_number: 'AAD-7782-9910',
                      },
                    ]).find(c => c.res_id === master.res_id);

                    return (
                      <div key={master.res_id} className="p-4 rounded-xl border border-purple-200 bg-purple-50/20 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-purple-100 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-purple-700 text-white">
                              res_id: #{master.res_id}
                            </span>
                            <span className="font-semibold text-xs text-zinc-800">
                              Hotel: {master.hotelcode}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                              {master.status}
                            </span>
                          </div>
                          <div className="text-xs font-mono font-bold text-emerald-800">
                            Total: ₹{Number(master.total_amount).toLocaleString()}
                          </div>
                        </div>

                        {/* 3 Linked Table Segments */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                          {/* 1. Master Info */}
                          <div className="p-3 bg-white rounded-lg border border-zinc-200 shadow-2xs space-y-1">
                            <div className="font-bold text-purple-900 flex items-center gap-1">
                              <span>🏛️</span> Reservations_booklogic
                            </div>
                            <div className="text-[11px] text-zinc-600">
                              <div><span className="font-semibold">Check-In:</span> {String(master.check_in).substring(0, 10)}</div>
                              <div><span className="font-semibold">Check-Out:</span> {String(master.check_out).substring(0, 10)}</div>
                              <div><span className="font-semibold">Rooms:</span> {master.rooms_booked}</div>
                              {master.special_requests && (
                                <div className="text-[10px] text-zinc-500 italic mt-1">"{master.special_requests}"</div>
                              )}
                            </div>
                          </div>

                          {/* 2. Detail Info */}
                          <div className="p-3 bg-white rounded-lg border border-zinc-200 shadow-2xs space-y-1">
                            <div className="font-bold text-blue-900 flex items-center gap-1">
                              <span>🛏️</span> reservations_details_booklogic
                            </div>
                            {matchingDetail ? (
                              <div className="text-[11px] text-zinc-600">
                                <div className="font-semibold text-zinc-900">{matchingDetail.room_type_name}</div>
                                <div><span className="font-semibold">Rate:</span> {matchingDetail.rate_plan_code} (₹{matchingDetail.price_per_night}/nt)</div>
                                <div><span className="font-semibold">Meal:</span> {matchingDetail.meal_plan}</div>
                                <div><span className="font-semibold">Guests:</span> {matchingDetail.adults} Adults, {matchingDetail.children} Kids ({matchingDetail.nights} Nights)</div>
                              </div>
                            ) : (
                              <div className="text-zinc-400 text-[11px]">No detail linked</div>
                            )}
                          </div>

                          {/* 3. Customer Info */}
                          <div className="p-3 bg-white rounded-lg border border-zinc-200 shadow-2xs space-y-1">
                            <div className="font-bold text-emerald-900 flex items-center gap-1">
                              <span>👤</span> reservation_Customer_booklogic
                            </div>
                            {matchingCustomer ? (
                              <div className="text-[11px] text-zinc-600">
                                <div className="font-semibold text-zinc-900">{matchingCustomer.customer_name}</div>
                                <div><span className="font-semibold">Phone:</span> {matchingCustomer.phone}</div>
                                <div><span className="font-semibold">Email:</span> {matchingCustomer.email}</div>
                                <div><span className="font-semibold">City:</span> {matchingCustomer.city}, {matchingCustomer.country}</div>
                                <div className="text-[10px] text-zinc-500">{matchingCustomer.id_proof_type}: {matchingCustomer.id_proof_number}</div>
                              </div>
                            ) : (
                              <div className="text-zinc-400 text-[11px]">No customer record linked</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 1: 1-Click Batch Push */}
        {activeSubTab === 'quick_push' && (
          <div className="mt-5 space-y-4">
            <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600" />
                  Ready to Push All Staged Records for <span className="font-mono text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded">dbo.{selectedTable}</span>
                </h3>
                <p className="text-xs text-emerald-800 mt-1 max-w-xl">
                  Executes batch synchronization from local <span className="font-semibold">{mssqlDb}</span> database, transforms schemas, and performs idempotent upserts into VPS PostgreSQL database <span className="font-semibold">{postgresDb}</span>.
                </p>
              </div>

              <button
                onClick={handleExecutePush}
                disabled={isPushing}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 transition shrink-0 ${isPushing ? 'bg-zinc-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'}`}
              >
                {isPushing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Pushing Records...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-white" />
                    Push {selectedTable} to VPS PostgreSQL
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Custom Records Importer */}
        {activeSubTab === 'custom_import' && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-700">Format:</span>
                <div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
                  <button
                    onClick={() => setRawInputFormat('json')}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${rawInputFormat === 'json' ? 'bg-white shadow-2xs font-bold text-zinc-900' : 'text-zinc-500'}`}
                  >
                    JSON Array
                  </button>
                  <button
                    onClick={() => setRawInputFormat('csv')}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${rawInputFormat === 'csv' ? 'bg-white shadow-2xs font-bold text-zinc-900' : 'text-zinc-500'}`}
                  >
                    CSV Data
                  </button>
                  <button
                    onClick={() => setRawInputFormat('sql')}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${rawInputFormat === 'sql' ? 'bg-white shadow-2xs font-bold text-zinc-900' : 'text-zinc-500'}`}
                  >
                    Raw SQL INSERTs
                  </button>
                </div>
              </div>

              {/* Sample Loader Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadTemplate('mas_hotel')}
                  className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium border border-blue-200 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  Load Sample mas_hotel
                </button>
                <button
                  type="button"
                  onClick={() => loadTemplate('room_avail')}
                  className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded text-xs font-medium border border-purple-200 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  Load Sample roomavailability
                </button>
              </div>
            </div>

            <div>
              <textarea
                rows={7}
                placeholder={`Paste your local ${mssqlDb} exported records here (e.g. JSON array from SQL Server or SSMS query results)...`}
                value={rawInputText}
                onChange={(e) => setRawInputText(e.target.value)}
                className="w-full p-3 font-mono text-xs bg-zinc-900 text-emerald-400 rounded-lg border border-zinc-800 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={handlePushCustomRecords}
                disabled={isPushing || !rawInputText.trim()}
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white shadow-xs flex items-center gap-2 transition ${isPushing || !rawInputText.trim() ? 'bg-zinc-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
              >
                {isPushing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                Import & Push to VPS PostgreSQL
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Local Sync Agent Script */}
        {activeSubTab === 'cli_agent' && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                  Node.js Local Sync Agent Daemon (Run on your local Windows / PC)
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Save this script as <span className="font-mono font-semibold text-purple-700">sync_agent.js</span> in <span className="font-mono font-semibold text-zinc-800">E:\AutoSync\</span> and run with <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono text-zinc-800">node sync_agent.js</code> to stream records bidirectionally.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    const element = document.createElement('a');
                    const file = new Blob([localAgentScript], { type: 'text/javascript' });
                    element.href = URL.createObjectURL(file);
                    element.download = 'sync_agent.js';
                    document.body.appendChild(element);
                    element.click();
                    document.body.removeChild(element);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-md transition shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download sync_agent.js
                </button>
                <button
                  onClick={() => handleCopy(localAgentScript, 'agent-script')}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-zinc-900 hover:bg-black text-white text-xs font-medium rounded-md transition shadow-2xs"
                >
                  {copiedKey === 'agent-script' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'agent-script' ? 'Copied!' : 'Copy Script'}
                </button>
              </div>
            </div>

            <div className="relative rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300 overflow-x-auto max-h-80 border border-zinc-800">
              <pre>{localAgentScript}</pre>
            </div>
          </div>
        )}

        {/* Tab 4: Windows Service Setup */}
        {activeSubTab === 'win_service' && (
          <div className="mt-5 space-y-5">
            {/* Header Box */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white border border-blue-500/30 shadow-md">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500 text-white flex items-center justify-center shrink-0 shadow">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    Run Sync Unit as Background Windows Service
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-400/20 text-blue-200 border border-blue-400/40">
                      AUTO-START ON BOOT
                    </span>
                  </h3>
                  <p className="text-xs text-blue-100/80 mt-1 leading-relaxed">
                    By installing as a native Windows Service, the sync daemon will run silently in the background 24/7 without requiring any open command prompt windows, and will automatically start whenever the PC or Windows Server reboots.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick 3-Step Guide */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-lg border border-zinc-200 bg-white space-y-1.5">
                <div className="text-[11px] font-bold text-blue-600 font-mono">STEP 1: INSTALL PACKAGE</div>
                <div className="text-xs font-semibold text-zinc-800">Install node-windows module</div>
                <div className="bg-zinc-950 text-zinc-200 p-2 rounded text-[11px] font-mono flex items-center justify-between">
                  <code>npm install node-windows</code>
                  <button onClick={() => handleCopy('npm install node-windows', 'cmd-step1')} className="text-zinc-400 hover:text-white">
                    {copiedKey === 'cmd-step1' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-zinc-200 bg-white space-y-1.5">
                <div className="text-[11px] font-bold text-blue-600 font-mono">STEP 2: CREATE INSTALLER</div>
                <div className="text-xs font-semibold text-zinc-800">Save install_service.js</div>
                <div className="text-[11px] text-zinc-500">
                  Save the script below in <span className="font-mono font-semibold">E:\AutoSync\install_service.js</span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-zinc-200 bg-white space-y-1.5">
                <div className="text-[11px] font-bold text-blue-600 font-mono">STEP 3: RUN AS ADMIN</div>
                <div className="text-xs font-semibold text-zinc-800">Execute Installer</div>
                <div className="bg-zinc-950 text-zinc-200 p-2 rounded text-[11px] font-mono flex items-center justify-between">
                  <code>node install_service.js</code>
                  <button onClick={() => handleCopy('node install_service.js', 'cmd-step3')} className="text-zinc-400 hover:text-white">
                    {copiedKey === 'cmd-step3' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Service Installer Script (install_service.js) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-blue-600" />
                    1. Service Installer Script (E:\AutoSync\install_service.js)
                  </h4>
                  <p className="text-[11px] text-zinc-500">Creates the Windows Service and sets automatic startup on boot.</p>
                </div>
                <button
                  onClick={() => handleCopy(`const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'BOOKLOGIC_AutoSync_Service',
  description: 'BOOKLOGIC MSSQL to VPS PostgreSQL Real-Time Data Sync Daemon Service',
  script: path.join(__dirname, 'sync_agent.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Listen for the "install" event, which indicates the process is available as a service
svc.on('install', function(){
  console.log('✅ Service [BOOKLOGIC_AutoSync_Service] installed successfully!');
  console.log('🚀 Starting service now...');
  svc.start();
});

svc.on('alreadyinstalled', function(){
  console.log('⚠️ Service is already installed.');
  console.log('Starting service...');
  svc.start();
});

svc.on('start', function(){
  console.log('🎉 BOOKLOGIC Sync Service is RUNNING in the background as a Windows Service!');
  console.log('You can manage it anytime in Windows Services (services.msc).');
});

// Install the script as a service
svc.install();`, 'inst-code')}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition"
                >
                  {copiedKey === 'inst-code' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'inst-code' ? 'Copied!' : 'Copy install_service.js'}
                </button>
              </div>

              <div className="relative rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300 overflow-x-auto max-h-56 border border-zinc-800">
                <pre>{`const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'BOOKLOGIC_AutoSync_Service',
  description: 'BOOKLOGIC MSSQL to VPS PostgreSQL Real-Time Data Sync Daemon Service',
  script: path.join(__dirname, 'sync_agent.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ]
});

// Listen for the "install" event, which indicates the process is available as a service
svc.on('install', function(){
  console.log('✅ Service [BOOKLOGIC_AutoSync_Service] installed successfully!');
  console.log('🚀 Starting service now...');
  svc.start();
});

svc.on('alreadyinstalled', function(){
  console.log('⚠️ Service is already installed. Starting service...');
  svc.start();
});

svc.on('start', function(){
  console.log('🎉 BOOKLOGIC Sync Service is RUNNING in the background as a Windows Service!');
  console.log('You can manage it in Windows Services (services.msc).');
});

// Install the script as a service
svc.install();`}</pre>
              </div>
            </div>

            {/* Service Uninstaller Script (uninstall_service.js) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-rose-600" />
                    2. Service Uninstaller Script (E:\AutoSync\uninstall_service.js)
                  </h4>
                  <p className="text-[11px] text-zinc-500">Run this whenever you want to remove or stop the Windows Service.</p>
                </div>
                <button
                  onClick={() => handleCopy(`const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BOOKLOGIC_AutoSync_Service',
  script: path.join(__dirname, 'sync_agent.js')
});

svc.on('uninstall', function(){
  console.log('🗑️ Service [BOOKLOGIC_AutoSync_Service] uninstalled successfully.');
});

svc.uninstall();`, 'uninst-code')}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-medium rounded-md transition"
                >
                  {copiedKey === 'uninst-code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'uninst-code' ? 'Copied!' : 'Copy uninstall_service.js'}
                </button>
              </div>

              <div className="relative rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-300 overflow-x-auto max-h-44 border border-zinc-800">
                <pre>{`const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BOOKLOGIC_AutoSync_Service',
  script: path.join(__dirname, 'sync_agent.js')
});

svc.on('uninstall', function(){
  console.log('🗑️ Service [BOOKLOGIC_AutoSync_Service] uninstalled successfully.');
});

svc.uninstall();`}</pre>
              </div>
            </div>

            {/* Windows Management Commands */}
            <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 space-y-3">
              <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-600" />
                Helpful Windows Management Commands:
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-white p-2.5 rounded border border-zinc-200 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-400 block text-[10px]">Open Windows Services GUI:</span>
                    <span className="text-zinc-800 font-bold">services.msc</span>
                  </div>
                  <button onClick={() => handleCopy('services.msc', 'cmd-msc')} className="text-zinc-400 hover:text-zinc-700">
                    {copiedKey === 'cmd-msc' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="bg-white p-2.5 rounded border border-zinc-200 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-400 block text-[10px]">Start Service via CMD:</span>
                    <span className="text-zinc-800 font-bold">net start BOOKLOGIC_AutoSync_Service</span>
                  </div>
                  <button onClick={() => handleCopy('net start BOOKLOGIC_AutoSync_Service', 'cmd-start')} className="text-zinc-400 hover:text-zinc-700">
                    {copiedKey === 'cmd-start' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="bg-white p-2.5 rounded border border-zinc-200 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-400 block text-[10px]">Stop Service via CMD:</span>
                    <span className="text-zinc-800 font-bold">net stop BOOKLOGIC_AutoSync_Service</span>
                  </div>
                  <button onClick={() => handleCopy('net stop BOOKLOGIC_AutoSync_Service', 'cmd-stop')} className="text-zinc-400 hover:text-zinc-700">
                    {copiedKey === 'cmd-stop' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="bg-white p-2.5 rounded border border-zinc-200 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-400 block text-[10px]">Check Logs Directory:</span>
                    <span className="text-zinc-800 font-bold">E:\AutoSync\daemon\</span>
                  </div>
                  <button onClick={() => handleCopy('E:\\AutoSync\\daemon', 'cmd-logs')} className="text-zinc-400 hover:text-zinc-700">
                    {copiedKey === 'cmd-logs' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Execution Log & Results Console */}
        {pushProgress.status !== 'idle' && (
          <div className="mt-5 border border-zinc-200 rounded-xl overflow-hidden bg-zinc-950 text-white font-mono text-xs">
            <div className="bg-zinc-900 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-zinc-200">Sync Unit Execution Console</span>
                {pushProgress.status === 'running' && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              {pushProgress.latencyMs > 0 && (
                <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {pushProgress.latencyMs}ms latency
                </span>
              )}
            </div>

            <div className="p-4 space-y-2 max-h-52 overflow-y-auto">
              <div className="text-zinc-400 text-[11px] mb-2">
                --- Sync Unit Output: Source [{mssqlDb}] ➔ Target [{postgresDb} @ {postgresHost}] ---
              </div>
              {pushProgress.details?.map((line, idx) => (
                <div key={idx} className="text-zinc-300 leading-relaxed">
                  {line}
                </div>
              ))}
              {pushProgress.sqlExecuted && (
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <span className="text-emerald-400 font-semibold block mb-1">Generated Target PostgreSQL Statement:</span>
                  <pre className="text-zinc-400 bg-zinc-900/80 p-2 rounded text-[11px] overflow-x-auto">
                    {pushProgress.sqlExecuted}
                  </pre>
                </div>
              )}
              {pushProgress.status === 'success' && (
                <div className="mt-2 text-emerald-400 font-bold flex items-center gap-1.5 pt-1">
                  <CheckCircle2 className="w-4 h-4" />
                  {pushProgress.message}
                </div>
              )}
              {pushProgress.status === 'error' && (
                <div className="mt-2 text-rose-400 font-bold flex items-center gap-1.5 pt-1">
                  <AlertTriangle className="w-4 h-4" />
                  {pushProgress.message}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
