
import React, { useState, useMemo } from 'react';
import { SyncedTable, Connection } from '../types';
import { MOCK_DATA_MAP } from '../constants';

interface TablesProps {
  tables: SyncedTable[];
  connections: Connection[];
  onToggleStatus: (id: string) => void;
  onDeleteTable: (id: string) => void;
}

const Tables: React.FC<TablesProps> = ({ tables, connections, onToggleStatus, onDeleteTable }) => {
  const [filterConnId, setFilterConnId] = useState<string>('all');
  const [previewTable, setPreviewTable] = useState<SyncedTable | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const filteredTables = filterConnId === 'all' 
    ? tables 
    : tables.filter(t => t.connectionId === filterConnId);

  // Dynamic data lookup based on table name
  const tableData = useMemo(() => {
    if (!previewTable) return [];
    
    // Look up data in MOCK_DATA_MAP
    const data = MOCK_DATA_MAP[previewTable.tableName];
    if (data) return data;
    
    // Fallback if table name not found in map
    return Array.from({ length: 50 }).map((_, i) => {
      const row: any = {};
      previewTable.schema.forEach(col => {
        row[col] = `${col}_val_${i + 1}`;
      });
      return row;
    });
  }, [previewTable]);

  // Derived pagination data
  const totalPages = Math.ceil(tableData.length / rowsPerPage) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return tableData.slice(start, start + rowsPerPage);
  }, [tableData, currentPage, rowsPerPage]);

  const handleOpenPreview = (table: SyncedTable) => {
    setPreviewTable(table);
    setCurrentPage(1);
  };

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight mb-2">Entity Registry</h2>
          <p className="text-slate-500 font-medium">Quản lý và xem trước các thực thể dữ liệu đã kết nối</p>
        </div>
        <div className="flex gap-4 bg-slate-900 p-2 rounded-2xl border border-white/5">
           <select 
              value={filterConnId}
              onChange={(e) => setFilterConnId(e.target.value)}
              className="bg-transparent text-slate-300 text-xs font-bold focus:ring-0 border-none outline-none px-4"
           >
             <option value="all" className="bg-slate-900">Tất cả kết nối</option>
             {connections.map(c => (
               <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
             ))}
           </select>
           <div className="w-px h-6 bg-white/10"></div>
           <button className="px-4 py-2 bg-indigo-600/10 text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-600/20 transition-all">
             Làm mới Schema
           </button>
        </div>
      </div>

      <div className="bg-slate-900/50 backdrop-blur-md rounded-[2.5rem] border border-white/5 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
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
                return (
                  <tr key={table.id} className="group hover:bg-white/[0.01] transition-colors">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center transition-all ${table.status === 'Active' ? 'text-indigo-400' : 'text-slate-600 grayscale'}`}>
                          <i className="fas fa-table text-sm"></i>
                        </div>
                        <div>
                          <span className={`block font-bold transition-colors ${table.status === 'Active' ? 'text-slate-200' : 'text-slate-500'}`}>
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
                        <span className="text-slate-200 font-bold">{(table.rowCount / 1000000).toFixed(2)}M</span>
                        <span className="text-[10px] text-slate-600 font-black uppercase">Dòng dữ liệu</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex justify-center">
                        <button 
                          onClick={() => onToggleStatus(table.id)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            table.status === 'Active' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-slate-800 text-slate-500 border border-slate-700'
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
                          className="w-10 h-10 bg-white/5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all flex items-center justify-center"
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

      {/* Data Preview Modal */}
      {previewTable && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-6xl bg-[#0f172a] border border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-10 py-8 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center text-xl shadow-lg shadow-indigo-600/20">
                  <i className="fas fa-database"></i>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white tracking-tight">Data Preview: {previewTable.tableName}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Dataset: {previewTable.datasetName}</span>
                    <div className="w-1 h-1 bg-slate-700 rounded-full"></div>
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Simulated Preview</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setPreviewTable(null)}
                className="w-12 h-12 bg-white/5 rounded-full text-slate-500 hover:text-white hover:bg-white/10 transition-all"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Pagination & Filter Bar */}
            <div className="px-10 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Rows per page</label>
                  <select 
                    value={rowsPerPage}
                    onChange={(e) => {
                      setRowsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-600 outline-none"
                  >
                    {[10, 20, 50, 100].map(val => (
                      <option key={val} value={val}>{val}</option>
                    ))}
                  </select>
                </div>
                <div className="h-6 w-px bg-white/10"></div>
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Showing {((currentPage - 1) * rowsPerPage) + 1} - {Math.min(currentPage * rowsPerPage, tableData.length)} of {tableData.length} samples
                </div>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center gap-2">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-indigo-600 transition-all disabled:opacity-30 disabled:hover:bg-white/5"
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
                        className={`w-10 h-10 rounded-xl text-xs font-bold transition-all ${
                          currentPage === pageNum 
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
                            : 'bg-white/5 text-slate-500 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  {totalPages > 5 && <span className="text-slate-600 px-2">...</span>}
                </div>

                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-indigo-600 transition-all disabled:opacity-30 disabled:hover:bg-white/5"
                >
                  <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>

            {/* Table Data View */}
            <div className="flex-1 overflow-auto custom-scrollbar p-6">
              <div className="border border-white/5 rounded-2xl overflow-hidden bg-black/20">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.05] border-b border-white/10 sticky top-0 z-10">
                      {previewTable.schema.map(col => (
                        <th key={col} className="px-6 py-4 text-[10px] font-black text-indigo-400 uppercase tracking-widest whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {paginatedData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                        {previewTable.schema.map(col => (
                          <td key={col} className="px-6 py-4 text-xs font-medium text-slate-400 whitespace-nowrap">
                            {row[col]?.toString() || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-10 py-6 bg-white/[0.02] border-t border-white/5 flex justify-end">
              <button 
                onClick={() => setPreviewTable(null)}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 shadow-xl transition-all"
              >
                Đóng Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tables;
