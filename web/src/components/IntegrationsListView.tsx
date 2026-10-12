import { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  RotateCcw, 
  Search, 
  RefreshCw, 
  Plus, 
  Copy, 
  Check, 
  AlertTriangle 
} from 'lucide-react';
import type { Integration } from '../types';

export const IntegrationsListView: React.FC = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [posFilter, setPosFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal confirmation state
  const [confirmModal, setConfirmModal] = useState<{
    integration: Integration;
    action: 'pause' | 'live' | 'delete' | 'restore';
  } | null>(null);

  const fetchIntegrations = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (posFilter !== 'all') params.set('pos', posFilter);
      params.set('includeDeleted', 'true');

      const res = await fetch(`/api/integrations?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setIntegrations(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch integrations:', err);
      setActionError('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, [statusFilter, posFilter]);

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStatusTransition = async (integrationId: string, action: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');

      setConfirmModal(null);
      await fetchIntegrations();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">0 PENDING SETUP</span>;
      case 1:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">1 CONFIG VERIFIED</span>;
      case 2:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-800">2 PAUSED</span>;
      case 3:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 flex items-center space-x-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span><span>3 LIVE</span></span>;
      case -1:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">DELETED</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">{status}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Active Integrations</h1>
          <p className="text-slate-600 text-sm mt-1">Manage, monitor, pause, and configure user POS ↔ Zkong ESL integrations.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => (window.location.href = '/onboarding')}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl flex items-center space-x-2 shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Integration</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-600 hover:text-rose-800 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Search business, email, or integration ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchIntegrations()}
          />
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          <select
            className="px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="3">LIVE</option>
            <option value="2">PAUSED</option>
            <option value="1">CONFIG VERIFIED</option>
            <option value="0">PENDING SETUP</option>
            <option value="-1">DELETED</option>
          </select>

          <select
            className="px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
          >
            <option value="all">All POS Types</option>
            <option value="clover">Clover</option>
            <option value="square">Square</option>
            <option value="toast">Toast</option>
            <option value="lightspeed">Lightspeed</option>
          </select>

          <button
            onClick={fetchIntegrations}
            className="p-2 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-600 cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Integrations Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading && integrations.length === 0 ? (
          <div className="p-12 text-center text-slate-500">Loading integrations...</div>
        ) : integrations.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <div>No integrations found matching your filters.</div>
            <button
              onClick={() => (window.location.href = '/onboarding')}
              className="text-indigo-600 font-semibold text-sm hover:underline"
            >
              Start Onboarding a New Integration →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <th className="px-6 py-3.5">Business & Email</th>
                  <th className="px-6 py-3.5">POS System</th>
                  <th className="px-6 py-3.5">Integration ID</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Created Date</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {integrations.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{item.registering_business_name}</div>
                      <div className="text-xs text-slate-500">{item.registering_business_email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="capitalize px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg text-xs font-medium uppercase tracking-wider">
                        {item.selected_pos}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-1.5 font-mono text-xs text-slate-700">
                        <span className="truncate max-w-[130px]">{item.integration_id}</span>
                        <button
                          onClick={() => handleCopyId(item.integration_id)}
                          className="text-slate-400 hover:text-slate-600 cursor-pointer"
                          title="Copy UUID"
                        >
                          {copiedId === item.integration_id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(item.status)}</td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {/* Status Transition Action Buttons */}
                        {item.status === 3 && (
                          <button
                            onClick={() => setConfirmModal({ integration: item, action: 'pause' })}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                            title="Pause Integration"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === 2 && (
                          <button
                            onClick={() => setConfirmModal({ integration: item, action: 'live' })}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            title="Resume / Go LIVE"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === 1 && (
                          <button
                            onClick={() => setConfirmModal({ integration: item, action: 'live' })}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            title="Activate LIVE"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === -1 ? (
                          <button
                            onClick={() => setConfirmModal({ integration: item, action: 'restore' })}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="Restore Integration"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmModal({ integration: item, action: 'delete' })}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Soft Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">
                Confirm {confirmModal.action.toUpperCase()}
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to <strong>{confirmModal.action}</strong> integration for{' '}
              <strong>{confirmModal.integration.registering_business_name}</strong>?
            </p>
            {confirmModal.action === 'pause' && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg">
                While paused, webhooks sent to this integration will be acknowledged but skipped.
              </p>
            )}
            {confirmModal.action === 'delete' && (
              <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg">
                This is a soft delete. The integration record will be marked deleted and can be restored if needed.
              </p>
            )}
            <div className="pt-2 flex justify-end space-x-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStatusTransition(confirmModal.integration.integration_id, confirmModal.action)}
                className={`px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer ${
                  confirmModal.action === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                Confirm {confirmModal.action.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
