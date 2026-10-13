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
  AlertTriangle,
  Edit2,
  Settings,
  X
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

// Edit modal state
  const [editModal, setEditModal] = useState<{
    integration: Integration;
  } | null>(null);

  const [editForm, setEditForm] = useState<{
    field_mappings: Record<string, string>;
    sync_rules: Array<{ trigger: string; actionType: 'unidirectional' | 'bidirectional'; description?: string }>;
    registering_business_name: string;
    registering_business_email: string;
    pos_configuration: Record<string, unknown>;
    zkong_configuration: Record<string, unknown>;
  }>({
    field_mappings: {},
    sync_rules: [],
    registering_business_name: '',
    registering_business_email: '',
    pos_configuration: {},
    zkong_configuration: {},
  });

  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [newMapping, setNewMapping] = useState({ zkKey: '', posKey: '' });

  // Common Zkong field options
  const zkongFieldOptions = [
    'barCode',
    'itemTitle',
    'price',
    'originalPrice',
    'memberPrice',
    'custFeature1',
    'custFeature2',
    'custFeature3',
    'custFeature4',
    'custFeature5',
    'attrCategory',
    'attrName',
    'productCode',
    'productSku',
  ];

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

  const openEditModal = (integration: Integration) => {
    setEditForm({
      field_mappings: integration.field_mappings || {},
      sync_rules: integration.sync_rules || [],
      registering_business_name: integration.registering_business_name,
      registering_business_email: integration.registering_business_email,
      pos_configuration: integration.pos_configuration || {},
      zkong_configuration: integration.zkong_configuration || {},
    });
    setEditError(null);
    setEditModal({ integration });
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/integrations/${editModal.integration.integration_id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update configuration');

      setEditModal(null);
      await fetchIntegrations();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSaving(false);
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

                        {item.status !== 3 && (
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="Edit Configuration"
                          >
                            <Edit2 className="w-4 h-4" />
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

      {/* Edit Configuration Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 text-indigo-600">
                <Settings className="w-6 h-6" />
                <h3 className="text-lg font-bold text-slate-900">Edit Integration Configuration</h3>
              </div>
              <button
                onClick={() => setEditModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600">
              Editing <strong>{editModal.integration.registering_business_name}</strong> ({editModal.integration.selected_pos.toUpperCase()})
              <br />
              <span className="text-amber-700 font-medium">Status: {editModal.integration.status === 3 ? 'LIVE' : editModal.integration.status === 2 ? 'PAUSED' : editModal.integration.status === 1 ? 'CONFIG VERIFIED' : 'PENDING SETUP'}</span>
              {editModal.integration.status === 3 && ' — Must pause to edit'}
            </p>

            {editError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center justify-between">
                <span>{editError}</span>
                <button onClick={() => setEditError(null)} className="text-rose-600 hover:text-rose-800 font-bold ml-4">✕</button>
              </div>
            )}

            {/* Field Mappings */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">Field Mappings</h4>
              <p className="text-xs text-slate-500 mb-3">Map Zkong fields to POS item attributes. Key = Zkong field, Value = POS field.</p>
              <div className="bg-slate-50 rounded-xl p-4 max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {Object.entries(editForm.field_mappings).map(([zkKey, posKey]) => (
                    <div key={zkKey} className="flex items-center space-x-2">
                      <select
                        value={zkKey}
                        onChange={(e) => {
                          const newKey = e.target.value;
                          if (newKey === zkKey) return;
                          setEditForm(prev => {
                            const next = { ...prev.field_mappings };
                            next[newKey] = next[zkKey];
                            delete next[zkKey];
                            return { ...prev, field_mappings: next };
                          });
                        }}
                        className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono text-slate-700"
                      >
                        {!zkongFieldOptions.includes(zkKey) && <option value={zkKey}>{zkKey}</option>}
                        {zkongFieldOptions.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <span className="text-slate-400">→</span>
                      <select
                        value={posKey}
                        onChange={(e) => setEditForm(prev => ({
                          ...prev,
                          field_mappings: { ...prev.field_mappings, [zkKey]: e.target.value }
                        }))}
                        className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {['name', 'price', 'sku', 'code', 'calculated_final_price', 'vat_percentage', 'discountPercentage', 'discountNumber', 'originalPrice'].map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setEditForm(prev => {
                          const next = { ...prev.field_mappings };
                          delete next[zkKey];
                          return { ...prev, field_mappings: next };
                        })}
                        className="text-rose-500 hover:text-rose-700 cursor-pointer"
                        title="Remove mapping"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center space-x-2 pt-2">
                    <select
                      value={newMapping.zkKey}
                      onChange={(e) => setNewMapping(prev => ({ ...prev, zkKey: e.target.value }))}
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">Zkong field...</option>
                      {zkongFieldOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <span className="text-slate-400">→</span>
                    <select
                      value={newMapping.posKey}
                      onChange={(e) => setNewMapping(prev => ({ ...prev, posKey: e.target.value }))}
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">POS field...</option>
                      {['name', 'price', 'sku', 'code', 'calculated_final_price', 'vat_percentage', 'discountPercentage', 'discountNumber', 'originalPrice'].map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (newMapping.zkKey && newMapping.posKey) {
                          setEditForm(prev => ({
                            ...prev,
                            field_mappings: { ...prev.field_mappings, [newMapping.zkKey]: newMapping.posKey }
                          }));
                          setNewMapping({ zkKey: '', posKey: '' });
                        }
                      }}
                      className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sync Rules */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">Sync Rules</h4>
              <p className="text-xs text-slate-500 mb-3">Define triggers and actions for bidirectional sync.</p>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="space-y-2">
                  {editForm.sync_rules.map((rule, idx) => (
                    <div key={idx} className="space-y-2 p-2 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center space-x-2">
                        <select
                          value={rule.trigger}
                          onChange={(e) => setEditForm(prev => ({
                            ...prev,
                            sync_rules: prev.sync_rules.map((r, i) => i === idx ? { ...r, trigger: e.target.value } : r)
                          }))}
                          className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="vat_change">VAT / Tax % change</option>
                          <option value="discount_applied">Discount % applied</option>
                          <option value="price_change">Price change</option>
                        </select>
                        <select
                          value={rule.actionType}
                          onChange={(e) => setEditForm(prev => ({
                            ...prev,
                            sync_rules: prev.sync_rules.map((r, i) => i === idx ? { ...r, actionType: e.target.value as 'unidirectional' | 'bidirectional' } : r)
                          }))}
                          className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="unidirectional">Unidirectional</option>
                          <option value="bidirectional">Bidirectional</option>
                        </select>
                        <button
                          onClick={() => setEditForm(prev => ({
                            ...prev,
                            sync_rules: prev.sync_rules.filter((_, i) => i !== idx)
                          }))}
                          className="text-rose-500 hover:text-rose-700 cursor-pointer"
                          title="Remove rule"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={rule.description}
                        onChange={(e) => setEditForm(prev => ({
                          ...prev,
                          sync_rules: prev.sync_rules.map((r, i) => i === idx ? { ...r, description: e.target.value } : r)
                        }))}
                        className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        placeholder="Description"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => setEditForm(prev => ({
                      ...prev,
                      sync_rules: [...prev.sync_rules, { trigger: '', actionType: 'unidirectional', description: '' }]
                    }))}
                    className="w-full px-3 py-2 text-xs border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 text-slate-600 cursor-pointer"
                  >
                    + Add Sync Rule
                  </button>
                </div>
              </div>
            </div>

            {/* Business Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">Business Information</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Name</label>
                  <input
                    type="text"
                    value={editForm.registering_business_name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, registering_business_name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Email</label>
                  <input
                    type="email"
                    value={editForm.registering_business_email}
                    onChange={(e) => setEditForm(prev => ({ ...prev, registering_business_email: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* POS Configuration (read-only fields shown for reference) */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">POS Configuration (read-only fields fixed at onboarding)</h4>
              <p className="text-xs text-slate-500 mb-3">POS type cannot be changed. Other fields can be updated.</p>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(editForm.pos_configuration).map(([key, value]) => {
                    const isReadOnly = key === 'posType' || key === 'merchantId';
                    return (
                      <div key={key}>
                        <label className="block text-xs font-medium text-slate-700 mb-1">{key} {isReadOnly && <span className="text-amber-600 ml-1">(fixed)</span>}</label>
                        <input
                          type="text"
                          value={String(value)}
                          onChange={isReadOnly ? undefined : (e) => setEditForm(prev => ({
                            ...prev,
                            pos_configuration: { ...prev.pos_configuration, [key]: e.target.value }
                          }))}
                          readOnly={isReadOnly}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isReadOnly}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Zkong Configuration */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">Zkong Configuration</h4>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(editForm.zkong_configuration).map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-slate-700 mb-1">{key}</label>
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => setEditForm(prev => ({
                          ...prev,
                          zkong_configuration: { ...prev.zkong_configuration, [key]: e.target.value }
                        }))}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end space-x-3 border-t border-slate-200">
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50"
              >
                {editSaving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
