
import React, { useState, useMemo } from 'react';
import { SyncedTable, Connection } from '../types';
import { MOCK_DATA_MAP } from '../constants';
import { fetchTableData } from '../services/bigquery';
import { getGoogleToken } from '../services/googleAuth';

interface TablesProps {
  tables: SyncedTable[];
  connections: Connection[];
  onToggleStatus: (id: string) => void;
  onDeleteTable: (id: string) => void;
  onDeleteTables?: (ids: string[]) => void;
  googleToken: string | null;
  setGoogleToken: (token: string | null) => void;
}

// Helper function to format cell values, especially timestamps
const formatCellValue = (value: any, columnType: string): string => {
  if (value === null || value === undefined) return '-';

  // Check if the column type is TIMESTAMP or the value looks like a timestamp
  const isTimestampType = columnType?.toUpperCase().includes('TIMESTAMP');

  // Check if value is a number that could be a Unix timestamp (in seconds or scientific notation)
  let numericValue: number | null = null;

  if (typeof value === 'number') {
    numericValue = value;
  } else if (typeof value === 'string') {
    // Handle scientific notation like "1.742304276E9"
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && /^[\d.]+[eE][+-]?\d+$/.test(value.trim())) {
      numericValue = parsed;
    } else if (!isNaN(parsed) && isTimestampType) {
      numericValue = parsed;
    }
  }

  // If it's a timestamp (Unix epoch in seconds, typically 10 digits ~ 1.6e9 to 2e9)
  if (numericValue !== null && (isTimestampType || (numericValue > 1e9 && numericValue < 3e9))) {
    try {
      const date = new Date(numericValue * 1000); // Convert seconds to milliseconds
      if (!isNaN(date.getTime())) {
        // Format as YYYY-MM-DD HH:mm:ss
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
    } catch (e) {
      // Fall through to default string conversion
    }
  }

  // If it's a number and was not handled as a timestamp above, format with commas
  if (typeof value === 'number') {
    return value.toLocaleString('en-US');
  }

  // If column type suggests numeric but comes as a string, try formatting
  const isNumericType = columnType?.toUpperCase().match(/INT|FLOAT|NUMERIC|DECIMAL|NUMBER/);
  if (typeof value === 'string' && isNumericType) {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return parsed.toLocaleString('en-US');
    }
  }

  return value.toString();
};

const Tables: React.FC<TablesProps> = ({ tables, connections, onToggleStatus, onDeleteTable, onDeleteTables, googleToken, setGoogleToken }) => {
  const [filterConnId, setFilterConnId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [previewTable, setPreviewTable] = useState<SyncedTable | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [previewSchema, setPreviewSchema] = useState<{ name: string, type: string }[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ field: 'tableName' | 'rowCount', direction: 'asc' | 'desc' }>({
    field: 'tableName',
    direction: 'asc'
  });

  const filteredTables = useMemo(() => {
    let result = tables.filter(t => {
      const matchesConn = filterConnId === 'all' || t.connectionId === filterConnId;
      const matchesSearch = searchQuery.trim() === '' ||
        t.tableName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.datasetName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesConn && matchesSearch;
    });

    // Apply sorting
    result.sort((a, b) => {
      if (sortConfig.field === 'tableName') {
        return sortConfig.direction === 'asc'
          ? a.tableName.localeCompare(b.tableName)
          : b.tableName.localeCompare(a.tableName);
      } else {
        const rowA = a.rowCount || 0;
        const rowB = b.rowCount || 0;
        return sortConfig.direction === 'asc' ? rowA - rowB : rowB - rowA;
      }
    });

    return result;
  }, [tables, filterConnId, searchQuery, sortConfig]);

  const handleSort = (field: 'tableName' | 'rowCount') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleToggleSelect = (id: string) => {
    setSelectedTableIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTableIds.size === filteredTables.length && filteredTables.length > 0) {
      setSelectedTableIds(new Set());
    } else {
      setSelectedTableIds(new Set(filteredTables.map(t => t.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedTableIds.size === 0) return;
    if (window.confirm(`Bạn có chắc chắn muốn xóa ${selectedTableIds.size} thực thể đã chọn?`)) {
      if (onDeleteTables) {
        onDeleteTables(Array.from(selectedTableIds));
      } else {
        Array.from(selectedTableIds).forEach(id => onDeleteTable(id));
      }
      setSelectedTableIds(new Set());
    }
  };

  // Effect to fetch real data when preview starts
  React.useEffect(() => {
    const loadRealData = async () => {
      if (!previewTable) {
        setPreviewData([]);
        return;
      }

      // Check if it's a BigQuery connection
      const conn = connections.find(c => c.id === previewTable.connectionId);
      if (conn?.type === 'BigQuery' && conn.projectId) {
        setIsLoadingPreview(true);
        try {
          const clientId = process.env.GOOGLE_CLIENT_ID || '';
          const { getTokenForConnection } = await import('../services/googleAuth');
          const token = await getTokenForConnection(conn, clientId);

          if (!token) {
            throw new Error('No valid token found for connection');
          }

          if (token !== googleToken && conn.authType !== 'ServiceAccount') {
            setGoogleToken(token);
          }

          console.log(`🧪 Previewing table: ${previewTable.tableName} using ${conn.authType} token`);
          const { rows, schema } = await fetchTableData(token, conn.projectId, previewTable.datasetName, previewTable.tableName, { limit: 1000 });

          console.log(`📊 Preview results: ${rows.length} rows, ${schema.length} columns`);
          setPreviewData(rows);
          setPreviewSchema(schema.length > 0 ? schema : previewTable.schema);
        } catch (error) {
          console.error("❌ Failed to load real data", error);
          setPreviewSchema(previewTable.schema);
          setPreviewData([]); // Ensure data is cleared on error
        } finally {
          setIsLoadingPreview(false);
        }
      } else {
        // Fallback for non-BigQuery or missing project info
        setPreviewSchema(previewTable.schema);
        const mock = MOCK_DATA_MAP[previewTable.tableName];
        if (mock) {
          setPreviewData(mock);
        } else {
          const fallback = Array.from({ length: 50 }).map((_, i) => {
            const row: any = {};
            previewTable.schema.forEach(col => {
              row[col.name] = `${col.name}_val_${i + 1}`;
            });
            return row;
          });
          setPreviewData(fallback);
        }
      }
    };

    loadRealData();
  }, [previewTable, connections]);

  // Derived pagination data
  const totalPages = Math.ceil(previewData.length / rowsPerPage) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return previewData.slice(start, start + rowsPerPage);
  }, [previewData, currentPage, rowsPerPage]);

  const handleOpenPreview = (table: SyncedTable) => {
    setPreviewTable(table);
    setCurrentPage(1);
  };

  return (
    <div className="p-10 max-w-[1600px] mx-auto h-full overflow-y-auto custom-scrollbar relative">
      <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Entity Registry</h2>
          <p className="text-slate-500 font-medium">Quản lý và xem trước các thực thể dữ liệu đã kết nối</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* Search Bar */}
          <div className="relative group">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors"></i>
            <input
              type="text"
              placeholder="Tìm kiếm bảng hoặc dataset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl py-2 pl-12 pr-4 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 min-w-[300px] placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all font-bold"
            />
          </div>

          <div className="flex gap-4 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-white/5 shadow-sm">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 px-4 border-r border-slate-100 dark:border-white/10">
              <i className="fas fa-sort-amount-down text-slate-500 text-[10px]"></i>
              <select
                value={`${sortConfig.field}-${sortConfig.direction}`}
                onChange={(e) => {
                  const [field, direction] = e.target.value.split('-') as [any, any];
                  setSortConfig({ field, direction });
                }}
                className="bg-transparent text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest focus:ring-0 border-none outline-none cursor-pointer"
              >
                <option value="tableName-asc" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Sort by Name (A-Z)</option>
                <option value="tableName-desc" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Sort by Name (Z-A)</option>
                <option value="rowCount-desc" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Sort by Rows (High-Low)</option>
                <option value="rowCount-asc" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Sort by Rows (Low-High)</option>
              </select>
            </div>

            <select
              value={filterConnId}
              onChange={(e) => setFilterConnId(e.target.value)}
              className="bg-transparent text-slate-600 dark:text-slate-300 text-xs font-bold focus:ring-0 border-none outline-none px-4 cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Tất cả kết nối</option>
              {connections.map(c => (
                <option key={c.id} value={c.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{c.name}</option>
              ))}
            </select>
            <div className="w-px h-6 bg-slate-100 dark:bg-white/10"></div>
            <button className="px-4 py-2 bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-600/20 transition-all">
              Làm mới Schema
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900/50 backdrop-blur-md rounded-[2.5rem] border border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
                <th className="px-8 py-6 w-10">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-indigo-600 focus:ring-indigo-500/50 cursor-pointer"
                      checked={filteredTables.length > 0 && selectedTableIds.size === filteredTables.length}
                      onChange={handleSelectAll}
                    />
                  </div>
                </th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">Source Entity</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">Kết nối</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">Dung lượng</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Trạng thái</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {filteredTables.map(table => {
                const conn = connections.find(c => c.id === table.connectionId);
                const isSelected = selectedTableIds.has(table.id);
                return (
                  <tr
                    key={table.id}
                    className={`group transition-colors ${isSelected ? 'bg-indigo-600/5' : 'hover:bg-white/[0.01]'}`}
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-indigo-600 focus:ring-indigo-500/50 cursor-pointer"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(table.id)}
                        />
                      </div>
                    </td>
                    <td className="px-8 py-6" onClick={() => handleToggleSelect(table.id)}>
                      <div className="flex items-center gap-4 cursor-pointer">
                        <div className={`w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center transition-all ${table.status === 'Active' ? 'text-indigo-400' : 'text-slate-600 grayscale'}`}>
                          <i className="fas fa-table text-sm"></i>
                        </div>
                        <div>
                          <span className={`block font-bold transition-colors ${table.status === 'Active' ? 'text-slate-900 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
                            {table.tableName}
                          </span>
                          <span className="text-[10px] text-slate-600 font-black uppercase">Dataset: {table.datasetName}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-slate-400 font-bold text-sm">{conn?.name || 'Unknown'}</span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-slate-900 dark:text-slate-200 font-bold">
                          {table.rowCount >= 1000000
                            ? (table.rowCount / 1000000).toFixed(2) + 'M'
                            : table.rowCount >= 1000
                              ? (table.rowCount / 1000).toFixed(1) + 'K'
                              : table.rowCount}
                        </span>
                        <span className="text-[10px] text-slate-600 font-black uppercase">Dòng dữ liệu</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex justify-center">
                        <button
                          onClick={() => onToggleStatus(table.id)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${table.status === 'Active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                            }`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${table.status === 'Active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
                          {table.status === 'Active' ? 'Active' : 'Paused'}
                        </button>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleOpenPreview(table)}
                          className="w-10 h-10 bg-indigo-600/10 rounded-xl text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center"
                          title="Xem dữ liệu thực tế"
                        >
                          <i className="fas fa-eye text-xs"></i>
                        </button>
                        <button
                          onClick={() => onDeleteTable(table.id)}
                          className="w-10 h-10 bg-slate-100 dark:bg-white/5 rounded-xl text-slate-400 dark:text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all flex items-center justify-center"
                          title="Gỡ bỏ thực thể"
                        >
                          <i className="fas fa-trash-alt text-xs"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {
        selectedTableIds.size > 0 && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[55] animate-in slide-in-from-bottom-10 duration-500">
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-indigo-100 dark:border-indigo-500/30 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-8 min-w-[500px]">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                  <i className="fas fa-check-double"></i>
                </div>
                <div>
                  <span className="block text-slate-900 dark:text-white font-black text-sm uppercase italic">Selected {selectedTableIds.size} Entities</span>
                  <span className="text-[10px] text-slate-500 font-bold">Manage multiple entities at once</span>
                </div>
              </div>

              <div className="h-10 w-px bg-slate-100 dark:bg-white/10"></div>

              <div className="ml-auto flex items-center gap-3">
                <button
                  onClick={() => setSelectedTableIds(new Set())}
                  className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Huỷ bỏ
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="px-8 py-2.5 rounded-xl bg-red-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-600/20 hover:bg-red-500 active:scale-95 transition-all"
                >
                  Xoá tất cả ({selectedTableIds.size})
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Data Preview Modal */}
      {
        previewTable && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 dark:bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="w-full max-w-7xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="px-10 py-8 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] flex justify-between items-center">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center text-xl shadow-lg shadow-indigo-600/20">
                    <i className="fas fa-database"></i>
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Data Preview: {previewTable.tableName}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Dataset: {previewTable.datasetName}</span>
                      <div className="w-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                      <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                        {isLoadingPreview ? 'Fetching Real Data...' : 'Real Data Preview'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setPreviewTable(null); setIsLoadingPreview(false); }}
                  className="w-12 h-12 bg-white/5 rounded-full text-slate-500 hover:text-white hover:bg-white/10 transition-all"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {/* Pagination & Filter Bar */}
              <div className="px-10 py-4 border-b border-slate-100 dark:border-white/5 bg-white dark:bg-[#0f172a] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Rows per page</label>
                    <select
                      value={rowsPerPage}
                      onChange={(e) => {
                        setRowsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-600 outline-none"
                    >
                      {[10, 20, 50, 100].map(val => (
                        <option key={val} value={val}>{val}</option>
                      ))}
                    </select>
                  </div>
                  <div className="h-6 w-px bg-slate-100 dark:bg-white/10"></div>
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Showing {previewData.length > 0 ? ((currentPage - 1) * rowsPerPage) + 1 : 0} - {Math.min(currentPage * rowsPerPage, previewData.length)} of {previewData.length} samples
                  </div>
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => prev - 1)}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 hover:text-white hover:bg-indigo-600 transition-all disabled:opacity-30"
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                      const pageNum = i + 1;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-10 h-10 rounded-xl text-xs font-bold transition-all ${currentPage === pageNum
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                            : 'bg-slate-50 dark:bg-white/5 text-slate-500 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
                            }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    {totalPages > 5 && <span className="text-slate-400 px-2">...</span>}
                  </div>

                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 hover:text-white hover:bg-indigo-600 transition-all disabled:opacity-30"
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              </div>

              {/* Table Data View */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="border border-slate-100 dark:border-white/5 rounded-2xl overflow-x-auto custom-scrollbar bg-slate-50/30 dark:bg-black/20">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-white/[0.05] border-b border-slate-100 dark:border-white/10 sticky top-0 z-10">
                        {previewSchema.map(col => (
                          <th key={col.name} className="px-6 py-4 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-indigo-600 dark:text-indigo-400">{col.name}</span>
                              <span className="text-[8px] text-slate-400 dark:text-slate-500 font-mono tracking-tight">{col.type}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.03]">
                      {isLoadingPreview ? (
                        <tr>
                          <td colSpan={previewSchema.length} className="px-6 py-20 text-center">
                            <i className="fas fa-circle-notch fa-spin text-3xl text-indigo-500 mb-4"></i>
                            <div className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">Querying BigQuery Engine...</div>
                          </td>
                        </tr>
                      ) : paginatedData.length === 0 ? (
                        <tr>
                          <td colSpan={previewSchema.length} className="px-6 py-20 text-center">
                            <i className="fas fa-database text-3xl text-slate-200 dark:text-slate-700 mb-4"></i>
                            <div className="text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest text-xs">No records found for this entity</div>
                          </td>
                        </tr>
                      ) : (
                        paginatedData.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                            {previewSchema.map(col => (
                              <td key={col.name} className="px-6 py-4 text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {formatCellValue(row[col.name], col.type)}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-10 py-6 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-white/5 flex justify-end">
                <button
                  onClick={() => setPreviewTable(null)}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 shadow-xl transition-all"
                >
                  Đóng Preview
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Tables;
