import { useState } from 'react';
import { 
  Building2, 
  CreditCard, 
  Layers, 
  Tag, 
  Sliders, 
  CheckCircle2, 
  ArrowRight, 
  ArrowLeft, 
  RefreshCw, 
  Copy, 
  Check, 
  AlertCircle 
} from 'lucide-react';
import type { SchemaField } from '../types';

export const OnboardingView: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Integration state
  const [integrationId, setIntegrationId] = useState<string>('');
  
  // Step 1
  const [businessName, setBusinessName] = useState<string>('Daily Groceries Supermarket');
  const [businessEmail, setBusinessEmail] = useState<string>('store@dailygroceries.com');

  // Step 2
  const [selectedPos, setSelectedPos] = useState<string>('clover');

  // Step 3 (Clover)
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('https://sandbox.dev.clover.com/v3/merchants');
  const [merchantId, setMerchantId] = useState<string>('');
  const [clientAppId, setClientAppId] = useState<string>('');
  const [apiToken, setApiToken] = useState<string>('');
  const [cloverAuthToken, setCloverAuthToken] = useState<string>('');

  // Step 4 (Zkong)
  const [zkAccount, setZkAccount] = useState<string>('VensweGlobalLLC');
  const [zkPassword, setZkPassword] = useState<string>('zkong@123');
  const [zkMerchantId, setZkMerchantId] = useState<string>('1786427294219');
  const [zkAgencyId, setZkAgencyId] = useState<string>('1558577702698');
  const [zkStoreId, setZkStoreId] = useState<string>('');
  const [zkApiBase, setZkApiBase] = useState<string>('https://esl-eu.zkong.com');
  const [zkongFields, setZkongFields] = useState<SchemaField[]>([]);
  const [posFields, setPosFields] = useState<SchemaField[]>([]);

  // Step 5 (Mappings & Rules)
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({
    barCode: 'sku',
    itemTitle: 'name',
    price: 'calculated_final_price',
    originalPrice: 'price',
  });

  const [syncRules] = useState<Array<{ trigger: string; actionType: 'unidirectional' | 'bidirectional'; description: string }>>([
    {
      trigger: 'vat_change',
      actionType: 'bidirectional',
      description: 'Recalculate final gross price and sync to Zkong tag, then update POS price',
    },
    {
      trigger: 'discount_applied',
      actionType: 'unidirectional',
      description: 'Mirror sale price to POS without overwriting base catalog items',
    },
  ]);

  const webhookUrl = integrationId 
    ? `https://clokong.fullform.one/webhooks/${integrationId}`
    : 'https://clokong.fullform.one/webhooks/<integrationId>';

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Step 1 & 2 Submit: Create Integration
  const handleCreateIntegration = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/onboarding/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, businessEmail, selectedPos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create integration');

      setIntegrationId(data.integrationId);
      setCurrentStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Save POS Config
  const handleSavePosConfig = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${integrationId}/pos-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl, merchantId, clientAppId, apiToken, cloverAuthToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save POS configuration');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Refresh Auth Token from Webhook
  const handleRefreshAuthToken = async () => {
    if (!integrationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${integrationId}/pos-auth-token`);
      const data = await res.json();
      if (data.cloverAuthToken) {
        setCloverAuthToken(data.cloverAuthToken);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Verify Clover Connection
  const handleVerifyClover = async () => {
    await handleSavePosConfig();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${integrationId}/verify-pos`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.verified) throw new Error(data.error || 'Clover connection verification failed');

      setCurrentStep(4);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Verify Zkong & Fetch Schema
  const handleVerifyZkong = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${integrationId}/zkong-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: zkAccount,
          password: zkPassword,
          merchantId: zkMerchantId,
          agencyId: zkAgencyId,
          storeId: zkStoreId,
          apiBase: zkApiBase,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) throw new Error(data.error || 'Zkong verification failed');

      setZkongFields(data.zkongFields || []);
      setPosFields(data.posFields || []);
      setCurrentStep(5);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Step 5: Complete Onboarding (Set Status LIVE)
  const handleCompleteOnboarding = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/onboarding/${integrationId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldMappings, syncRules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete onboarding');

      setCurrentStep(6);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    { number: 1, title: 'Business Info', icon: Building2 },
    { number: 2, title: 'POS Selection', icon: CreditCard },
    { number: 3, title: 'Clover Setup', icon: Layers },
    { number: 4, title: 'Zkong Setup', icon: Tag },
    { number: 5, title: 'Rules & Mapping', icon: Sliders },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header Stepper */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">POS to Zkong Integration Onboarding</h1>
        <p className="text-slate-600">Connect your grocery or retail POS with ESL Cloud tags in a few simple steps.</p>
        
        <div className="mt-8 flex items-center justify-between border-b border-slate-200 pb-6">
          {steps.map((s) => {
            const Icon = s.icon;
            const isCompleted = currentStep > s.number;
            const isCurrent = currentStep === s.number;
            return (
              <div key={s.number} className="flex items-center space-x-3">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                    isCompleted 
                      ? 'bg-emerald-600 text-white' 
                      : isCurrent 
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' 
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <div className="hidden sm:block">
                  <div className="text-xs uppercase font-semibold text-slate-400">Step {s.number}</div>
                  <div className={`text-sm font-medium ${isCurrent ? 'text-indigo-600' : 'text-slate-700'}`}>
                    {s.title}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* STEP 1: Business Details */}
      {currentStep === 1 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Step 1: Business Details</h2>
            <p className="text-sm text-slate-500">Provide the basic merchant identification details.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Business Name</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
                placeholder="e.g. Green Valley Supermarket"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Business Email Address</label>
              <input
                type="email"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
                placeholder="e.g. contact@greenvalley.com"
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              onClick={() => setCurrentStep(2)}
              disabled={!businessName || !businessEmail}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center space-x-2 transition-colors cursor-pointer"
            >
              <span>Next: POS Selection</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: POS Selection */}
      {currentStep === 2 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Step 2: Select Your Point of Sale System</h2>
            <p className="text-sm text-slate-500">Pick the POS system your store uses. Clover is currently active for this setup.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { id: 'clover', name: 'Clover POS', desc: 'Direct webhook & REST catalog integration', enabled: true },
              { id: 'square', name: 'Square', desc: 'Catalog & Orders API (Coming soon)', enabled: false },
              { id: 'toast', name: 'Toast POS', desc: 'Restaurant & grocery inventory (Coming soon)', enabled: false },
              { id: 'lightspeed', name: 'Lightspeed Retail', desc: 'Retail cloud inventory (Coming soon)', enabled: false },
            ].map((pos) => (
              <div
                key={pos.id}
                onClick={() => pos.enabled && setSelectedPos(pos.id)}
                className={`p-5 rounded-xl border-2 transition-all flex flex-col justify-between ${
                  !pos.enabled 
                    ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                    : selectedPos === pos.id 
                    ? 'border-indigo-600 bg-indigo-50/50 cursor-pointer shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 cursor-pointer bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{pos.name}</span>
                    {selectedPos === pos.id && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{pos.desc}</p>
                </div>
                {!pos.enabled && (
                  <span className="mt-3 text-[11px] font-semibold text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded self-start">
                    Planned adapter
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => setCurrentStep(1)}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              onClick={handleCreateIntegration}
              disabled={loading}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <span>{loading ? 'Creating...' : 'Next: Configure Clover'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Clover Configuration & Validation */}
      {currentStep === 3 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Step 3: Clover POS Configuration & Validation</h2>
            <p className="text-sm text-slate-500">Configure your Clover API credentials and register your dynamic webhook URL.</p>
          </div>

          <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-900">Your Dedicated Webhook URL</div>
            <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-indigo-200 font-mono text-xs text-slate-800">
              <span className="truncate mr-2">{webhookUrl}</span>
              <button 
                onClick={copyWebhookUrl} 
                className="text-indigo-600 hover:text-indigo-800 font-sans flex items-center space-x-1 cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="text-xs">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-indigo-800">
              Copy this URL and enter it in Clover Developer Dashboard &gt; Your Apps &gt; App Settings &gt; Webhooks.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Clover API Base URL</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Merchant ID</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. GAAC1D37ZZDV1"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Client App ID</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. 34WZ9HQM8M0G0"
                value={clientAppId}
                onChange={(e) => setClientAppId(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">API Token (Bearer Token)</label>
              <input
                type="password"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="Merchant API token for inventory access"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-semibold text-slate-700">Clover Webhook Auth Code</label>
                <button
                  type="button"
                  onClick={handleRefreshAuthToken}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center space-x-1 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh from Webhook Handshake</span>
                </button>
              </div>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="Will auto-populate once Clover sends test verification code"
                value={cloverAuthToken}
                onChange={(e) => setCloverAuthToken(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              onClick={handleVerifyClover}
              disabled={loading || !merchantId || !apiToken}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <span>{loading ? 'Verifying...' : 'Verify Clover & Continue'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Zkong Configuration & Validation */}
      {currentStep === 4 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Step 4: Zkong ESL Cloud Configuration</h2>
            <p className="text-sm text-slate-500">Enter your ESL server account details to authenticate and pull supported tag schema fields.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Zkong Server Base URL</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                value={zkApiBase}
                onChange={(e) => setZkApiBase(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Account Username</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. VensweGlobalLLC"
                value={zkAccount}
                onChange={(e) => setZkAccount(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Account Password</label>
              <input
                type="password"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="Password"
                value={zkPassword}
                onChange={(e) => setZkPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Merchant ID</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. 1786427294219"
                value={zkMerchantId}
                onChange={(e) => setZkMerchantId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Agency ID</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. 1558577702698"
                value={zkAgencyId}
                onChange={(e) => setZkAgencyId(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Store ID (Optional)</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 text-slate-900 font-mono text-xs"
                placeholder="e.g. 1607566698661 (From /zk/store/storeList)"
                value={zkStoreId}
                onChange={(e) => setZkStoreId(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => setCurrentStep(3)}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              onClick={handleVerifyZkong}
              disabled={loading || !zkAccount || !zkPassword}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <span>{loading ? 'Authenticating...' : 'Verify Zkong & Pull Schema'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Field Mapping & Rule Engine */}
      {currentStep === 5 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-8">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Step 5: Dynamic Field Mapping & Rule Engine</h2>
            <p className="text-sm text-slate-500">Map how POS items populate Zkong tag fields and configure real-time automation rules.</p>
          </div>

          {/* Part A: Field Mappings */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold">A</span>
                <span>Field Mapping (Dual Column)</span>
              </h3>
              <span className="text-xs text-slate-500">
                {zkongFields.length} Zkong fields &bull; {posFields.length} POS fields detected
              </span>
            </div>
            
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
              <div className="grid grid-cols-2 bg-slate-50 px-4 py-2.5 font-semibold text-xs text-slate-600 uppercase">
                <div>Zkong Electronic Shelf Tag Field</div>
                <div>Source POS Field</div>
              </div>
              {(zkongFields.length > 0 ? zkongFields : [
                { key: 'barCode', label: 'Product Barcode (Tag ID)' },
                { key: 'itemTitle', label: 'Product Title' },
                { key: 'price', label: 'Selling Price (Active Tag Price)' },
                { key: 'originalPrice', label: 'Original / Was Price' },
                { key: 'custFeature1', label: 'Extended Field 1 (Was / Promo Price)' },
                { key: 'custFeature2', label: 'Extended Field 2 (Discount %)' },
              ]).map((row) => (
                <div key={row.key} className="grid grid-cols-2 px-4 py-3 items-center">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{row.label}</div>
                    <div className="text-xs font-mono text-slate-400">{row.key}</div>
                  </div>
                  <div>
                    <select
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                      value={fieldMappings[row.key] || 'none'}
                      onChange={(e) => setFieldMappings({ ...fieldMappings, [row.key]: e.target.value })}
                    >
                      <option value="none">-- Do Not Map --</option>
                      {(posFields.length > 0 ? posFields : [
                        { key: 'sku', label: 'Product SKU (Raw)' },
                        { key: 'code', label: 'Product Barcode / Code' },
                        { key: 'name', label: 'Product Title / Name' },
                        { key: 'price', label: 'Raw POS Price (cents)' },
                        { key: 'calculated_final_price', label: 'Calculated Final Price (Rule Engine)' },
                        { key: 'vat_percentage', label: 'VAT / Tax Rate Percentage' },
                      ]).map((posF) => (
                        <option key={posF.key} value={posF.key}>
                          {posF.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Part B: Automation & Sync Rules */}
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center space-x-2">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold">B</span>
              <span>Automation & Sync Rules (IFTTT)</span>
            </h3>

            <div className="space-y-3">
              {syncRules.map((rule, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{rule.trigger}</span>
                    <span className="text-xs px-2.5 py-1 bg-indigo-100 text-indigo-800 font-semibold rounded-full uppercase">
                      {rule.actionType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{rule.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <button
              onClick={() => setCurrentStep(4)}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              onClick={handleCompleteOnboarding}
              disabled={loading}
              className="px-7 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center space-x-2 shadow-sm cursor-pointer"
            >
              <span>{loading ? 'Finalizing...' : 'Save Configuration & Go LIVE'}</span>
              <CheckCircle2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: Completion Screen */}
      {currentStep === 6 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Integration is LIVE!</h2>
            <p className="text-slate-600 mt-1 max-w-md mx-auto">
              Your {businessName} POS is now actively connected to Zkong ESL Cloud. Updates from Clover will dynamically sync in real time.
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-left max-w-md mx-auto space-y-2 text-xs font-mono text-slate-700">
            <div><strong>Integration ID:</strong> {integrationId}</div>
            <div><strong>Status:</strong> LIVE (3)</div>
            <div><strong>POS:</strong> Clover POS</div>
            <div><strong>Zkong Account:</strong> {zkAccount}</div>
          </div>

          <div className="pt-4 flex justify-center space-x-4">
            <button
              onClick={() => (window.location.href = '/integrations')}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors cursor-pointer"
            >
              Manage Integrations
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
