export type SyncStatus = 'running' | 'paused' | 'stopped' | 'error';
export type SyncMode = 'cdc' | 'change_tracking' | 'watermark';
export type ConflictResolution = 'source_wins' | 'target_wins' | 'latest_timestamp';
export type OperationType = 'INSERT' | 'UPDATE' | 'DELETE' | 'INITIAL_PUSH';

export interface ColumnMapping {
  sourceName: string;
  sourceType: string;
  targetName: string;
  targetType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
}

export interface TableMapping {
  id: string;
  sourceSchema: string;
  sourceTable: string;
  targetSchema: string;
  targetTable: string;
  primaryKey: string;
  enabled: boolean;
  columns: ColumnMapping[];
  filterPredicate?: string;
  totalSourceRows: number;
  totalTargetRows: number;
  lastSyncedAt?: string;
}

export interface MssqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  syncMode: SyncMode;
  pollIntervalMs: number;
  changeTrackingRetentionDays?: number;
}

export interface PostgresConfig {
  connectionString?: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  schema: string;
}

export interface SyncSettings {
  batchSize: number;
  pollIntervalMs: number;
  maxConcurrency: number;
  conflictResolution: ConflictResolution;
  autoCreateTargetTables: boolean;
  enableDeadLetterQueue: boolean;
  simulateRealtimeTraffic: boolean;
}

export interface SyncEvent {
  id: string;
  timestamp: string;
  sourceTable: string;
  targetTable: string;
  operation: OperationType;
  lsn: string;
  recordId: string | number;
  payload: Record<string, unknown>;
  targetSql: string;
  status: 'synced' | 'pending' | 'failed';
  latencyMs: number;
  errorMessage?: string;
}

export interface SyncStats {
  status: SyncStatus;
  totalSyncedRows: number;
  rowsPerSecond: number;
  averageLatencyMs: number;
  queueBacklog: number;
  activeWorkers: number;
  uptimeSeconds: number;
  lastSyncTime: string | null;
  failedEventsCount: number;
  totalInserts: number;
  totalUpdates: number;
  totalDeletes: number;
}

export interface DatabaseRecord {
  [key: string]: unknown;
}

export interface TableDataComparison {
  tableName: string;
  sourceRows: DatabaseRecord[];
  targetRows: DatabaseRecord[];
  inSync: boolean;
  sourceCount: number;
  targetCount: number;
}

export interface ReservationMasterRecord {
  res_id: number;
  hotelcode: string;
  booking_date: string;
  check_in: string;
  check_out: string;
  rooms_booked: number;
  total_amount: number;
  currency: string;
  status: string;
  special_requests?: string;
  updateflag: number;
  created_at: string;
  modified_at: string;
  _synced_at?: string;
}

export interface ReservationDetailRecord {
  detail_id: number;
  res_id: number;
  roomtypeid: number;
  room_type_name: string;
  rooms_booked: number;
  rate_plan_code: string;
  price_per_night: number;
  tax_amount: number;
  meal_plan: string;
  adults: number;
  children: number;
  nights: number;
  check_in: string;
  check_out: string;
}

export interface ReservationCustomerRecord {
  customer_id: number;
  res_id: number;
  first_name: string;
  last_name: string;
  customer_name: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  country?: string;
  id_proof_type?: string;
  id_proof_number?: string;
}

