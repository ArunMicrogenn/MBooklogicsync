import { TableMapping } from '../types';

export const initialTableMappings: TableMapping[] = [
  {
    id: 'tbl-customers',
    sourceSchema: 'dbo',
    sourceTable: 'Customers',
    targetSchema: 'public',
    targetTable: 'customers',
    primaryKey: 'customer_id',
    enabled: true,
    totalSourceRows: 5,
    totalTargetRows: 5,
    lastSyncedAt: new Date().toISOString(),
    columns: [
      { sourceName: 'CustomerID', sourceType: 'INT IDENTITY(1,1)', targetName: 'customer_id', targetType: 'BIGINT PRIMARY KEY', isPrimaryKey: true, isNullable: false },
      { sourceName: 'FirstName', sourceType: 'NVARCHAR(100)', targetName: 'first_name', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'LastName', sourceType: 'NVARCHAR(100)', targetName: 'last_name', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'Email', sourceType: 'NVARCHAR(255)', targetName: 'email', targetType: 'VARCHAR(255) UNIQUE', isPrimaryKey: false, isNullable: false },
      { sourceName: 'Phone', sourceType: 'NVARCHAR(50)', targetName: 'phone', targetType: 'VARCHAR(50)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'CreditLimit', sourceType: 'DECIMAL(18,2)', targetName: 'credit_limit', targetType: 'NUMERIC(18,2)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'IsActive', sourceType: 'BIT', targetName: 'is_active', targetType: 'BOOLEAN', isPrimaryKey: false, isNullable: false },
      { sourceName: 'CreatedAt', sourceType: 'DATETIME2', targetName: 'created_at', targetType: 'TIMESTAMPTZ', isPrimaryKey: false, isNullable: false },
      { sourceName: 'ModifiedAt', sourceType: 'DATETIME2', targetName: 'modified_at', targetType: 'TIMESTAMPTZ', isPrimaryKey: false, isNullable: false },
    ],
  },
  {
    id: 'tbl-orders',
    sourceSchema: 'dbo',
    sourceTable: 'Orders',
    targetSchema: 'public',
    targetTable: 'orders',
    primaryKey: 'order_id',
    enabled: true,
    totalSourceRows: 4,
    totalTargetRows: 4,
    lastSyncedAt: new Date().toISOString(),
    columns: [
      { sourceName: 'OrderID', sourceType: 'BIGINT IDENTITY(1,1)', targetName: 'order_id', targetType: 'BIGINT PRIMARY KEY', isPrimaryKey: true, isNullable: false },
      { sourceName: 'CustomerID', sourceType: 'INT', targetName: 'customer_id', targetType: 'BIGINT REFERENCES public.customers(customer_id)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'OrderDate', sourceType: 'DATETIME2', targetName: 'order_date', targetType: 'TIMESTAMPTZ', isPrimaryKey: false, isNullable: false },
      { sourceName: 'TotalAmount', sourceType: 'DECIMAL(18,2)', targetName: 'total_amount', targetType: 'NUMERIC(18,2)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'Status', sourceType: 'NVARCHAR(50)', targetName: 'status', targetType: 'VARCHAR(50)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'ShippingAddress', sourceType: 'NVARCHAR(MAX)', targetName: 'shipping_address', targetType: 'TEXT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'LastUpdated', sourceType: 'DATETIME2', targetName: 'last_updated', targetType: 'TIMESTAMPTZ', isPrimaryKey: false, isNullable: false },
    ],
  },
  {
    id: 'tbl-inventory',
    sourceSchema: 'dbo',
    sourceTable: 'Inventory',
    targetSchema: 'public',
    targetTable: 'inventory',
    primaryKey: 'product_id',
    enabled: true,
    totalSourceRows: 4,
    totalTargetRows: 4,
    lastSyncedAt: new Date().toISOString(),
    columns: [
      { sourceName: 'ProductID', sourceType: 'INT IDENTITY(1,1)', targetName: 'product_id', targetType: 'BIGINT PRIMARY KEY', isPrimaryKey: true, isNullable: false },
      { sourceName: 'SKU', sourceType: 'NVARCHAR(64)', targetName: 'sku', targetType: 'VARCHAR(64) UNIQUE', isPrimaryKey: false, isNullable: false },
      { sourceName: 'ProductName', sourceType: 'NVARCHAR(200)', targetName: 'product_name', targetType: 'VARCHAR(200)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'StockQuantity', sourceType: 'INT', targetName: 'stock_quantity', targetType: 'INTEGER', isPrimaryKey: false, isNullable: false },
      { sourceName: 'UnitPrice', sourceType: 'DECIMAL(18,2)', targetName: 'unit_price', targetType: 'NUMERIC(18,2)', isPrimaryKey: false, isNullable: false },
      { sourceName: 'Category', sourceType: 'NVARCHAR(100)', targetName: 'category', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'UpdatedAt', sourceType: 'DATETIME2', targetName: 'updated_at', targetType: 'TIMESTAMPTZ', isPrimaryKey: false, isNullable: false },
    ],
  },
  {
    id: 'tbl-hotels',
    sourceSchema: 'dbo',
    sourceTable: 'mas_hotel',
    targetSchema: 'public',
    targetTable: 'mas_hotel',
    primaryKey: 'hotel_id',
    enabled: true,
    totalSourceRows: 6,
    totalTargetRows: 6,
    lastSyncedAt: new Date().toISOString(),
    columns: [
      { sourceName: 'HotelID', sourceType: 'BIGINT IDENTITY(1,1)', targetName: 'hotel_id', targetType: 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY', isPrimaryKey: true, isNullable: false },
      { sourceName: 'HotelCode', sourceType: 'VARCHAR(50)', targetName: 'hotelcode', targetType: 'VARCHAR(50) UNIQUE NOT NULL', isPrimaryKey: false, isNullable: false },
      { sourceName: 'HotelName', sourceType: 'VARCHAR(255)', targetName: 'hotel_name', targetType: 'VARCHAR(255) NOT NULL', isPrimaryKey: false, isNullable: false },
      { sourceName: 'City', sourceType: 'VARCHAR(100)', targetName: 'city', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'State', sourceType: 'VARCHAR(100)', targetName: 'state', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Country', sourceType: 'VARCHAR(100)', targetName: 'country', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Phone', sourceType: 'VARCHAR(50)', targetName: 'phone', targetType: 'VARCHAR(50)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Email', sourceType: 'VARCHAR(100)', targetName: 'email', targetType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'TotalRooms', sourceType: 'INT', targetName: 'total_rooms', targetType: 'INTEGER DEFAULT 50', isPrimaryKey: false, isNullable: true },
      { sourceName: 'StarRating', sourceType: 'NUMERIC(2,1)', targetName: 'star_rating', targetType: 'NUMERIC(2,1) DEFAULT 4.0', isPrimaryKey: false, isNullable: true },
      { sourceName: 'IsActive', sourceType: 'BIT', targetName: 'is_active', targetType: 'BOOLEAN DEFAULT TRUE', isPrimaryKey: false, isNullable: false },
      { sourceName: 'CreatedAt', sourceType: 'DATETIME2', targetName: 'created_at', targetType: 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP', isPrimaryKey: false, isNullable: false },
      { sourceName: 'ModifiedAt', sourceType: 'DATETIME2', targetName: 'modified_at', targetType: 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP', isPrimaryKey: false, isNullable: false },
    ],
  },
  {
    id: 'tbl-roomavailability',
    sourceSchema: 'dbo',
    sourceTable: 'trans_roomavailability_chart_datewise',
    targetSchema: 'public',
    targetTable: 'trans_roomavailability_chart_datewise',
    primaryKey: 'avaidd',
    enabled: true,
    totalSourceRows: 148,
    totalTargetRows: 148,
    lastSyncedAt: new Date().toISOString(),
    columns: [
      { sourceName: 'avaidd', sourceType: 'BIGINT IDENTITY(1,1)', targetName: 'avaidd', targetType: 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY', isPrimaryKey: true, isNullable: false },
      { sourceName: 'Roomtypeid', sourceType: 'BIGINT', targetName: 'roomtypeid', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'fromdate', sourceType: 'DATETIME', targetName: 'fromdate', targetType: 'TIMESTAMP', isPrimaryKey: false, isNullable: true },
      { sourceName: 'todate', sourceType: 'DATETIME', targetName: 'todate', targetType: 'TIMESTAMP', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Availablerooms', sourceType: 'BIGINT', targetName: 'availablerooms', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'uploadflg', sourceType: 'BIGINT', targetName: 'uploadflg', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'notupload', sourceType: 'BIGINT', targetName: 'notupload', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Remarks', sourceType: 'VARCHAR(2000)', targetName: 'remarks', targetType: 'VARCHAR(2000)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Fromtime', sourceType: 'DATETIME', targetName: 'fromtime', targetType: 'TIMESTAMP', isPrimaryKey: false, isNullable: true },
      { sourceName: 'Totime', sourceType: 'DATETIME', targetName: 'totime', targetType: 'TIMESTAMP', isPrimaryKey: false, isNullable: true },
      { sourceName: 'allotcode', sourceType: 'VARCHAR(500)', targetName: 'allotcode', targetType: 'VARCHAR(500)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'hotelcode', sourceType: 'VARCHAR(500)', targetName: 'hotelcode', targetType: 'VARCHAR(500)', isPrimaryKey: false, isNullable: true },
      { sourceName: 'IRM_Update', sourceType: 'BIGINT', targetName: 'irm_update', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
      { sourceName: 'stopsales', sourceType: 'BIGINT', targetName: 'stopsales', targetType: 'BIGINT', isPrimaryKey: false, isNullable: true },
    ],
  },
];

export const sqlServerCdcScript = `-- ==========================================================
-- T-SQL: Enable CDC (Change Data Capture) on SQL Server
-- Run this on your Local Microsoft SQL Server instance
-- ==========================================================

USE master;
GO

-- 1. Ensure SQL Server Agent is running (Required for CDC capture job)
EXEC xp_servicecontrol N'querystate', N'SQLServerAGENT';
GO

-- 2. Enable CDC on the database
USE ProductionERP;
GO

IF (SELECT is_cdc_enabled FROM sys.databases WHERE name = 'ProductionERP') = 0
BEGIN
    EXEC sys.sp_cdc_enable_db;
    PRINT 'CDC successfully enabled for database ProductionERP';
END
GO

-- 3. Enable CDC on Customers table
IF (SELECT is_tracked_by_cdc FROM sys.tables WHERE name = 'Customers' AND schema_id = SCHEMA_ID('dbo')) = 0
BEGIN
    EXEC sys.sp_cdc_enable_table
        @source_schema = N'dbo',
        @source_name   = N'Customers',
        @role_name     = NULL, -- or specify a security role
        @supports_net_changes = 1;
    PRINT 'CDC enabled for dbo.Customers';
END
GO

-- 4. Enable CDC on Orders table
IF (SELECT is_tracked_by_cdc FROM sys.tables WHERE name = 'Orders' AND schema_id = SCHEMA_ID('dbo')) = 0
BEGIN
    EXEC sys.sp_cdc_enable_table
        @source_schema = N'dbo',
        @source_name   = N'Orders',
        @role_name     = NULL,
        @supports_net_changes = 1;
    PRINT 'CDC enabled for dbo.Orders';
END
GO

-- 5. Enable CDC on Inventory table
IF (SELECT is_tracked_by_cdc FROM sys.tables WHERE name = 'Inventory' AND schema_id = SCHEMA_ID('dbo')) = 0
BEGIN
    EXEC sys.sp_cdc_enable_table
        @source_schema = N'dbo',
        @source_name   = N'Inventory',
        @role_name     = NULL,
        @supports_net_changes = 1;
    PRINT 'CDC enabled for dbo.Inventory';
END
GO

-- 6. Enable CDC on mas_hotel table (Master Hotels)
IF (SELECT is_tracked_by_cdc FROM sys.tables WHERE name = 'mas_hotel' AND schema_id = SCHEMA_ID('dbo')) = 0
BEGIN
    EXEC sys.sp_cdc_enable_table
        @source_schema = N'dbo',
        @source_name   = N'mas_hotel',
        @role_name     = NULL,
        @supports_net_changes = 1;
    PRINT 'CDC enabled for dbo.mas_hotel';
END
GO

-- 7. Enable CDC on trans_roomavailability_chart_datewise table
IF (SELECT is_tracked_by_cdc FROM sys.tables WHERE name = 'trans_roomavailability_chart_datewise' AND schema_id = SCHEMA_ID('dbo')) = 0
BEGIN
    EXEC sys.sp_cdc_enable_table
        @source_schema = N'dbo',
        @source_name   = N'trans_roomavailability_chart_datewise',
        @role_name     = NULL,
        @supports_net_changes = 1;
    PRINT 'CDC enabled for dbo.trans_roomavailability_chart_datewise';
END
GO

-- Verify CDC tracking
SELECT capture_instance, source_schema, source_table, start_lsn, create_date 
FROM cdc.change_tables;
GO
`;

export const postgresTargetDdlScript = `-- ==========================================================
-- PostgreSQL DDL: Target Tables on Virtual Server
-- Run this on your Virtual Server PostgreSQL instance (Database: BOOKLOGIC)
-- ==========================================================

CREATE SCHEMA IF NOT EXISTS public;

-- 1. Hotel Master Target Table (BOOKLOGIC.public.mas_hotel)
CREATE TABLE IF NOT EXISTS public.mas_hotel (
    hotel_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    hotelcode VARCHAR(50) UNIQUE NOT NULL,
    hotel_name VARCHAR(255) NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    total_rooms INTEGER DEFAULT 50,
    star_rating NUMERIC(2,1) DEFAULT 4.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    _synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mas_hotel_code ON public.mas_hotel(hotelcode);
CREATE INDEX IF NOT EXISTS idx_mas_hotel_city ON public.mas_hotel(city);
CREATE INDEX IF NOT EXISTS idx_mas_hotel_active ON public.mas_hotel(is_active);

-- 2. Customers Target Table
CREATE TABLE IF NOT EXISTS public.customers (
    customer_id BIGINT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    credit_limit NUMERIC(18,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_modified_at ON public.customers(modified_at);

-- 3. Orders Target Table
CREATE TABLE IF NOT EXISTS public.orders (
    order_id BIGINT PRIMARY KEY,
    customer_id BIGINT REFERENCES public.customers(customer_id) ON DELETE CASCADE,
    order_date TIMESTAMPTZ NOT NULL,
    total_amount NUMERIC(18,2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    shipping_address TEXT,
    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_last_updated ON public.orders(last_updated);

-- 4. Inventory Target Table
CREATE TABLE IF NOT EXISTS public.inventory (
    product_id BIGINT PRIMARY KEY,
    sku VARCHAR(64) UNIQUE NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    stock_quantity INTEGER DEFAULT 0,
    unit_price NUMERIC(18,2) NOT NULL,
    category VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_sku ON public.inventory(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory(category);

-- 5. Room Availability Chart Datewise (BOOKLOGIC Target Table)
CREATE TABLE IF NOT EXISTS public.trans_roomavailability_chart_datewise (
    avaidd BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    roomtypeid BIGINT,
    fromdate TIMESTAMP WITHOUT TIME ZONE,
    todate TIMESTAMP WITHOUT TIME ZONE,
    availablerooms BIGINT,
    uploadflg BIGINT,
    notupload BIGINT,
    remarks VARCHAR(2000),
    fromtime TIMESTAMP WITHOUT TIME ZONE,
    totime TIMESTAMP WITHOUT TIME ZONE,
    allotcode VARCHAR(500),
    hotelcode VARCHAR(500),
    irm_update BIGINT,
    stopsales BIGINT,
    _synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roomavail_hotel_room ON public.trans_roomavailability_chart_datewise (hotelcode, roomtypeid);
CREATE INDEX IF NOT EXISTS idx_roomavail_dates ON public.trans_roomavailability_chart_datewise (fromdate, todate);

-- 6. Sync Watermark Metadata Table (Tracks last LSN processed by background service)
CREATE TABLE IF NOT EXISTS public._sync_metadata (
    source_table VARCHAR(100) PRIMARY KEY,
    last_processed_lsn VARCHAR(64) NOT NULL,
    last_sync_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    synced_records_count BIGINT DEFAULT 0
);
`;
