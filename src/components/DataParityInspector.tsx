import React, { useState } from 'react';
import { Database, CheckCircle2, AlertCircle, ArrowRight, Plus, RefreshCw, Layers } from 'lucide-react';
import { TableDataComparison } from '../types';

interface DataParityInspectorProps {
  dataComparison: Record<string, TableDataComparison>;
  onRefresh: () => void;
  onSimulateMutation: (type: string, data?: Record<string, unknown>) => void;
}

export const DataParityInspector: React.FC<DataParityInspectorProps> = ({
  dataComparison,
  onRefresh,
  onSimulateMutation,
}) => {
  const [selectedTable, setSelectedTable] = useState<'customers' | 'orders' | 'inventory' | 'mas_hotel' | 'reservations'>('mas_hotel');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newHotelName, setNewHotelName] = useState('');
  const [newHotelCity, setNewHotelCity] = useState('');
  const [isPushingHotels, setIsPushingHotels] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);

  const current = dataComparison[selectedTable] || {
    tableName: selectedTable,
    sourceRows: [],
    targetRows: [],
    inSync: true,
    sourceCount: 0,
    targetCount: 0,
  };

  const handleAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    onSimulateMutation('INSERT_CUSTOMER', {
      firstName: newFirstName || 'Taylor',
      lastName: newLastName || 'Swift',
      email: newEmail || `taylor.${Date.now().toString().slice(-4)}@corp.com`,
    });
    setNewFirstName('');
    setNewLastName('');
    setNewEmail('');
    setShowAddModal(false);
  };

  const handleAddHotel = (e: React.FormEvent) => {
    e.preventDefault();
    onSimulateMutation('INSERT_HOTEL', {
      hotelName: newHotelName || 'BookLogic Heritage Grand',
      city: newHotelCity || 'Bengaluru',
      state: 'Karnataka',
    });
    setNewHotelName('');
    setNewHotelCity('');
    setShowAddModal(false);
  };

  const handlePushHotelsToPostgres = async () => {
    setIsPushingHotels(true);
    setPushResult(null);
    try {
      const res = await fetch('/api/sync/push-hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: 'BOOKLOGIC', host: '72.61.240.34' }),
      });
      const data = await res.json();
      setPushResult(data.message || 'Queued mas_hotel records for sync.');
      onRefresh();
    } catch (err: unknown) {
      setPushResult(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setIsPushingHotels(false);
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-2xs">
      {/* Header & Table Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-700 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Live Data Parity Explorer (Local SQL Server vs VPS PostgreSQL BOOKLOGIC)
            </h2>
            <p className="text-xs text-zinc-500">
              Real-time verification of data consistency between Local SQL Server and PostgreSQL BOOKLOGIC
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {selectedTable === 'mas_hotel' && (
            <>
              <button
                onClick={() => setShowAddModal(!showAddModal)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-700 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 transition shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Hotel to MSSQL
              </button>
              <button
                onClick={handlePushHotelsToPostgres}
                disabled={isPushingHotels}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition shadow-2xs disabled:opacity-50"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                {isPushingHotels ? 'Pushing...' : 'Push mas_hotel to PostgreSQL'}
              </button>
            </>
          )}

          {selectedTable === 'customers' && (
            <button
              onClick={() => setShowAddModal(!showAddModal)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-700 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 transition shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Customer to MSSQL
            </button>
          )}

          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition"
            title="Refresh database parity state"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {pushResult && (
        <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <span>{pushResult}</span>
          <button onClick={() => setPushResult(null)} className="text-emerald-600 hover:text-emerald-900 font-bold ml-2">×</button>
        </div>
      )}

      {/* Table Selector Tabs & Parity Status */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-lg bg-zinc-100 border border-zinc-200/80 text-xs">
          <button
            onClick={() => setSelectedTable('mas_hotel')}
            className={`px-3 py-1 rounded-md font-medium transition ${selectedTable === 'mas_hotel' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}`}
          >
            mas_hotel ({dataComparison.mas_hotel?.sourceCount || 0})
          </button>
          <button
            onClick={() => setSelectedTable('customers')}
            className={`px-3 py-1 rounded-md font-medium transition ${selectedTable === 'customers' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}`}
          >
            Customers ({dataComparison.customers?.sourceCount || 0})
          </button>
          <button
            onClick={() => setSelectedTable('orders')}
            className={`px-3 py-1 rounded-md font-medium transition ${selectedTable === 'orders' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}`}
          >
            Orders ({dataComparison.orders?.sourceCount || 0})
          </button>
          <button
            onClick={() => setSelectedTable('inventory')}
            className={`px-3 py-1 rounded-md font-medium transition ${selectedTable === 'inventory' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}`}
          >
            Inventory ({dataComparison.inventory?.sourceCount || 0})
          </button>
          <button
            onClick={() => setSelectedTable('reservations')}
            className={`px-3 py-1 rounded-md font-medium transition ${selectedTable === 'reservations' ? 'bg-purple-900 text-white shadow-xs font-semibold' : 'text-purple-700 hover:text-purple-950'}`}
          >
            reservations (Inbound: {dataComparison.reservations?.sourceCount || 0})
          </button>
        </div>

        {/* Sync Status Badge */}
        <div className="flex items-center gap-2">
          {current.inSync ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              100% In-Sync ({current.targetCount}/{current.sourceCount} rows matched)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              Syncing ({current.targetCount}/{current.sourceCount} rows replicated)
            </span>
          )}
        </div>
      </div>

      {/* Add Record Form (collapsible) */}
      {showAddModal && selectedTable === 'mas_hotel' && (
        <form onSubmit={handleAddHotel} className="mt-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-xs space-y-2">
          <span className="font-semibold text-zinc-800 block">Insert New Record into Local SQL Server (`dbo.mas_hotel`):</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Hotel Name (e.g., Grand Palace Hotel)"
              value={newHotelName}
              onChange={(e) => setNewHotelName(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
            />
            <input
              type="text"
              placeholder="City (e.g., Bengaluru)"
              value={newHotelCity}
              onChange={(e) => setNewHotelCity(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-2.5 py-1 text-zinc-600 hover:bg-zinc-200 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-zinc-900 hover:bg-black text-white font-medium rounded transition"
            >
              Commit to Local BOOKLOGIC MSSQL
            </button>
          </div>
        </form>
      )}

      {showAddModal && selectedTable === 'customers' && (
        <form onSubmit={handleAddCustomer} className="mt-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-xs space-y-2">
          <span className="font-semibold text-zinc-800 block">Insert New Record into Local SQL Server (`dbo.Customers`):</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="First Name (e.g., Marcus)"
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
            />
            <input
              type="text"
              placeholder="Last Name (e.g., Vance)"
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
            />
            <input
              type="email"
              placeholder="Email (e.g., m.vance@apex.io)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-2.5 py-1 text-zinc-600 hover:bg-zinc-200 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-zinc-900 hover:bg-black text-white font-medium rounded transition"
            >
              Commit to Local MSSQL
            </button>
          </div>
        </form>
      )}

      {/* Side-by-Side Table Comparison */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source: Local SQL Server */}
        <div className="border border-blue-200 rounded-lg overflow-hidden">
          <div className="bg-blue-50/80 px-3 py-2 border-b border-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-bold text-blue-900">
                Source: Local SQL Server (dbo.{selectedTable.charAt(0).toUpperCase() + selectedTable.slice(1)})
              </span>
            </div>
            <span className="text-[11px] font-mono text-blue-700 font-semibold">{current.sourceCount} rows</span>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-medium sticky top-0">
                {selectedTable === 'mas_hotel' && (
                  <tr>
                    <th className="px-3 py-2">Hotel Code</th>
                    <th className="px-3 py-2">Hotel Name</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Rooms</th>
                    <th className="px-3 py-2">Rating</th>
                  </tr>
                )}
                {selectedTable === 'customers' && (
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Credit Limit</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                )}
                {selectedTable === 'orders' && (
                  <tr>
                    <th className="px-3 py-2">Order ID</th>
                    <th className="px-3 py-2">Cust ID</th>
                    <th className="px-3 py-2">Total Amount</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Last Updated</th>
                  </tr>
                )}
                {selectedTable === 'inventory' && (
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Product Name</th>
                    <th className="px-3 py-2">Stock</th>
                    <th className="px-3 py-2">Unit Price</th>
                  </tr>
                )}
                {selectedTable === 'reservations' && (
                  <tr>
                    <th className="px-3 py-2">Res ID</th>
                    <th className="px-3 py-2">Guest Name</th>
                    <th className="px-3 py-2">Dates</th>
                    <th className="px-3 py-2">Rooms</th>
                    <th className="px-3 py-2">Total Amount</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {selectedTable === 'mas_hotel' && (current.sourceRows as any[]).map((row, idx) => (
                  <tr key={row.HotelID || row.HotelCode || idx} className="hover:bg-blue-50/40 transition">
                    <td className="px-3 py-2 font-mono font-bold text-blue-900">{row.HotelCode}</td>
                    <td className="px-3 py-2 text-zinc-900 font-medium">{row.HotelName}</td>
                    <td className="px-3 py-2 text-zinc-600">{row.City}, {row.State || row.Country}</td>
                    <td className="px-3 py-2 font-mono text-zinc-800">{row.TotalRooms} rms</td>
                    <td className="px-3 py-2 text-amber-600 font-semibold">★ {row.StarRating}</td>
                  </tr>
                ))}

                {selectedTable === 'customers' && (current.sourceRows as any[]).map((row, idx) => (
                  <tr key={row.CustomerID || idx} className="hover:bg-blue-50/40 transition">
                    <td className="px-3 py-2 font-mono font-medium text-zinc-900">{row.CustomerID}</td>
                    <td className="px-3 py-2 text-zinc-800">{row.FirstName} {row.LastName}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-600">{row.Email}</td>
                    <td className="px-3 py-2 font-mono text-zinc-800">${Number(row.CreditLimit || 0).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${row.IsActive ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                        {row.IsActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}

                {selectedTable === 'orders' && (current.sourceRows as any[]).map((row, idx) => (
                  <tr key={row.OrderID || idx} className="hover:bg-blue-50/40 transition">
                    <td className="px-3 py-2 font-mono font-medium text-zinc-900">#{row.OrderID}</td>
                    <td className="px-3 py-2 font-mono text-zinc-600">{row.CustomerID}</td>
                    <td className="px-3 py-2 font-mono font-medium text-zinc-800">${Number(row.TotalAmount || 0).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">
                        {row.Status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-500 font-mono">
                      {new Date(row.LastUpdated || row.OrderDate).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}

                {selectedTable === 'inventory' && (current.sourceRows as any[]).map((row, idx) => (
                  <tr key={row.ProductID || idx} className="hover:bg-blue-50/40 transition">
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-900">{row.SKU}</td>
                    <td className="px-3 py-2 text-zinc-800 max-w-[150px] truncate">{row.ProductName}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-800">{row.StockQuantity}</td>
                    <td className="px-3 py-2 font-mono text-zinc-700">${Number(row.UnitPrice || 0).toFixed(2)}</td>
                  </tr>
                ))}

                {selectedTable === 'reservations' && (current.sourceRows as any[]).map((row, idx) => (
                  <tr key={row.reservation_id || idx} className="hover:bg-purple-50/40 transition">
                    <td className="px-3 py-2 font-mono font-bold text-purple-900">#{row.reservation_id}</td>
                    <td className="px-3 py-2 text-zinc-900 font-medium">
                      <div>{row.guest_name}</div>
                      <div className="text-[10px] text-zinc-500">{row.hotelcode}</div>
                    </td>
                    <td className="px-3 py-2 text-zinc-600 font-mono text-[11px]">{String(row.check_in).substring(0, 10)} ➔ {String(row.check_out).substring(0, 10)}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-800">{row.rooms_booked} rm</td>
                    <td className="px-3 py-2 font-mono font-bold text-emerald-700">₹{Number(row.total_amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Target: Virtual Server PostgreSQL */}
        <div className="border border-indigo-200 rounded-lg overflow-hidden">
          <div className="bg-indigo-50/80 px-3 py-2 border-b border-indigo-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-xs font-bold text-indigo-900">
                Target: Virtual Server PostgreSQL (public.{selectedTable})
              </span>
            </div>
            <span className="text-[11px] font-mono text-indigo-700 font-semibold">{current.targetCount} rows</span>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-medium sticky top-0">
                {selectedTable === 'mas_hotel' && (
                  <tr>
                    <th className="px-3 py-2">hotelcode</th>
                    <th className="px-3 py-2">hotel_name</th>
                    <th className="px-3 py-2">city/state</th>
                    <th className="px-3 py-2">rooms</th>
                    <th className="px-3 py-2">rating</th>
                  </tr>
                )}
                {selectedTable === 'customers' && (
                  <tr>
                    <th className="px-3 py-2">customer_id</th>
                    <th className="px-3 py-2">name</th>
                    <th className="px-3 py-2">email</th>
                    <th className="px-3 py-2">credit_limit</th>
                    <th className="px-3 py-2">is_active</th>
                  </tr>
                )}
                {selectedTable === 'orders' && (
                  <tr>
                    <th className="px-3 py-2">order_id</th>
                    <th className="px-3 py-2">customer_id</th>
                    <th className="px-3 py-2">total_amount</th>
                    <th className="px-3 py-2">status</th>
                    <th className="px-3 py-2">last_updated</th>
                  </tr>
                )}
                {selectedTable === 'inventory' && (
                  <tr>
                    <th className="px-3 py-2">sku</th>
                    <th className="px-3 py-2">product_name</th>
                    <th className="px-3 py-2">stock_quantity</th>
                    <th className="px-3 py-2">unit_price</th>
                  </tr>
                )}
                {selectedTable === 'reservations' && (
                  <tr>
                    <th className="px-3 py-2">reservation_id</th>
                    <th className="px-3 py-2">guest_name</th>
                    <th className="px-3 py-2">dates</th>
                    <th className="px-3 py-2">rooms</th>
                    <th className="px-3 py-2">total_amount</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {selectedTable === 'mas_hotel' && (current.targetRows as any[]).map((row, idx) => (
                  <tr key={row.hotel_id || row.hotelcode || idx} className="hover:bg-indigo-50/40 transition">
                    <td className="px-3 py-2 font-mono font-bold text-indigo-900">{row.hotelcode}</td>
                    <td className="px-3 py-2 text-zinc-900 font-medium">{row.hotel_name}</td>
                    <td className="px-3 py-2 text-zinc-600">{row.city}, {row.state || row.country}</td>
                    <td className="px-3 py-2 font-mono text-zinc-800">{row.total_rooms} rms</td>
                    <td className="px-3 py-2 text-amber-600 font-semibold">★ {row.star_rating}</td>
                  </tr>
                ))}

                {selectedTable === 'customers' && (current.targetRows as any[]).map((row, idx) => (
                  <tr key={row.customer_id || idx} className="hover:bg-indigo-50/40 transition">
                    <td className="px-3 py-2 font-mono font-medium text-zinc-900">{row.customer_id}</td>
                    <td className="px-3 py-2 text-zinc-800">{row.first_name} {row.last_name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-600">{row.email}</td>
                    <td className="px-3 py-2 font-mono text-zinc-800">${Number(row.credit_limit || 0).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                        {row.is_active ? 'true' : 'false'}
                      </span>
                    </td>
                  </tr>
                ))}

                {selectedTable === 'orders' && (current.targetRows as any[]).map((row, idx) => (
                  <tr key={row.order_id || idx} className="hover:bg-indigo-50/40 transition">
                    <td className="px-3 py-2 font-mono font-medium text-zinc-900">#{row.order_id}</td>
                    <td className="px-3 py-2 font-mono text-zinc-600">{row.customer_id}</td>
                    <td className="px-3 py-2 font-mono font-medium text-zinc-800">${Number(row.total_amount || 0).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800">
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-500 font-mono">
                      {new Date(row.last_updated || row.order_date).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}

                {selectedTable === 'inventory' && (current.targetRows as any[]).map((row, idx) => (
                  <tr key={row.product_id || idx} className="hover:bg-indigo-50/40 transition">
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-900">{row.sku}</td>
                    <td className="px-3 py-2 text-zinc-800 max-w-[150px] truncate">{row.product_name}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-800">{row.stock_quantity}</td>
                    <td className="px-3 py-2 font-mono text-zinc-700">${Number(row.unit_price || 0).toFixed(2)}</td>
                  </tr>
                ))}

                {selectedTable === 'reservations' && (current.targetRows as any[]).map((row, idx) => (
                  <tr key={row.reservation_id || idx} className="hover:bg-purple-50/40 transition">
                    <td className="px-3 py-2 font-mono font-bold text-purple-900">#{row.reservation_id}</td>
                    <td className="px-3 py-2 text-zinc-900 font-medium">
                      <div>{row.guest_name}</div>
                      <div className="text-[10px] text-zinc-500">{row.hotelcode}</div>
                    </td>
                    <td className="px-3 py-2 text-zinc-600 font-mono text-[11px]">{String(row.check_in).substring(0, 10)} ➔ {String(row.check_out).substring(0, 10)}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-zinc-800">{row.rooms_booked} rm</td>
                    <td className="px-3 py-2 font-mono font-bold text-emerald-700">₹{Number(row.total_amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
