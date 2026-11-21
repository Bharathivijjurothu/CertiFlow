import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Activity, Server, Database, Cpu, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchHealth,
  fetchDemoUsers,
  fetchBatches,
  fetchBatchDetails,
  login,
  HealthResponse
} from './services/api';
import { User, Batch, BatchStatus } from './types/batch';
import { UserSwitcher } from './components/UserSwitcher';
import { BatchList } from './components/BatchList';
import { BatchDetails } from './components/BatchDetails';
import { CreateBatchModal } from './components/CreateBatchModal';
import { StatusCard } from './components/StatusCard';
import { DemoUsers } from './components/DemoUsers';
import { PublicVerification } from './components/PublicVerification';
import './App.css';

export const App: React.FC = () => {
  // Check if loaded with /verify path or token query
  const isVerifyUrl = typeof window !== 'undefined' && (
    window.location.pathname.startsWith('/verify') ||
    window.location.search.includes('token=') ||
    window.location.search.includes('cert=')
  );

  // Navigation & User State
  const [activeTab, setActiveTab] = useState<'batches' | 'health' | 'verify'>(
    isVerifyUrl ? 'verify' : 'batches'
  );
  const [demoUsers, setDemoUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Batches State
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BatchStatus | 'ALL' | 'PENDING_REVIEW'>('ALL');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // System Health State
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Initial Load: Demo users and health
  useEffect(() => {
    async function init() {
      try {
        const usersRes = await fetchDemoUsers();
        setDemoUsers(usersRes.users);

        // Auto login first user (Anika, TC) if no user active
        if (usersRes.users.length > 0 && !currentUser) {
          handleSelectUser(usersRes.users[0]);
        }
      } catch (err) {
        console.error('Failed to load demo users:', err);
      }
    }
    init();
  }, []);

  // Handle Switch User
  const handleSelectUser = async (user: User) => {
    try {
      setAuthLoading(true);
      const auth = await login(user.email, 'CertiFlow@2026');
      setCurrentUser(auth.user);
      setSelectedBatchId(null);
      setSelectedBatch(null);
    } catch (err) {
      console.error('Login error:', err);
    } finally {
      setAuthLoading(false);
    }
  };

  // Load Batches whenever currentUser or statusFilter changes
  const loadBatches = useCallback(async () => {
    if (!currentUser) return;
    try {
      setBatchesLoading(true);
      const filter = (statusFilter === 'ALL' || statusFilter === 'PENDING_REVIEW') ? undefined : statusFilter;
      const data = await fetchBatches(filter);
      setBatches(data);
    } catch (err) {
      console.error('Failed to fetch batches:', err);
    } finally {
      setBatchesLoading(false);
    }
  }, [currentUser, statusFilter]);

  useEffect(() => {
    if (activeTab === 'batches') {
      loadBatches();
    }
  }, [activeTab, loadBatches]);

  // Load single batch details if selected
  const loadSelectedBatch = useCallback(async (id: string) => {
    try {
      setBatchesLoading(true);
      const batch = await fetchBatchDetails(id);
      setSelectedBatch(batch);
    } catch (err) {
      console.error('Failed to load batch details:', err);
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBatchId) {
      loadSelectedBatch(selectedBatchId);
    } else {
      setSelectedBatch(null);
    }
  }, [selectedBatchId, loadSelectedBatch]);

  // Health Diagnostics Loader
  const loadHealthData = useCallback(async () => {
    try {
      setHealthLoading(true);
      setHealthError(null);
      const data = await fetchHealth();
      setHealth(data);
      setLastCheck(new Date());
    } catch (err: any) {
      setHealthError(err.message || 'Failed to connect to health API');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'health') {
      loadHealthData();
    }
  }, [activeTab, loadHealthData]);

  useEffect(() => {
    if (activeTab !== 'health' || !autoRefresh) return;
    const interval = setInterval(loadHealthData, 5000);
    return () => clearInterval(interval);
  }, [activeTab, autoRefresh, loadHealthData]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-section">
          <h1>
            <Layers size={32} color="#60a5fa" />
            CertiFlow
          </h1>
          <div className="phase-badge">Phase 6 &amp; 7: Verification &amp; Finalization</div>
        </div>

        {/* Tab Selector */}
        <div className="main-nav-tabs">
          <button
            className={`nav-tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('batches');
              setSelectedBatchId(null);
            }}
          >
            <Layers size={16} /> Batches &amp; Approvals
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'verify' ? 'active' : ''}`}
            onClick={() => setActiveTab('verify')}
          >
            <ShieldCheck size={16} /> Public Verification
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => setActiveTab('health')}
          >
            <Activity size={16} /> System Health
          </button>
        </div>
      </header>

      {/* Role Simulation Switcher (Available across workflows) */}
      <UserSwitcher
        currentUser={currentUser}
        onSelectUser={handleSelectUser}
        demoUsers={demoUsers}
        loading={authLoading}
      />

      {/* Main Content Area */}
      <main style={{ marginTop: '2rem' }}>
        {activeTab === 'verify' ? (
          <PublicVerification onNavigateHome={() => setActiveTab('batches')} />
        ) : activeTab === 'batches' ? (
          selectedBatch ? (
            <BatchDetails
              batch={selectedBatch}
              currentUser={currentUser}
              onBack={() => {
                setSelectedBatchId(null);
                loadBatches();
              }}
              onRefresh={() => loadSelectedBatch(selectedBatch.id)}
            />
          ) : (
            <BatchList
              batches={batches}
              loading={batchesLoading}
              currentUser={currentUser}
              onSelectBatch={(id) => setSelectedBatchId(id)}
              onOpenCreateModal={() => setCreateModalOpen(true)}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          )
        ) : (
          /* System Health Tab (Phase 1 Preserved) */
          <div>
            <div className="section-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>Infrastructure Diagnostics</h2>
                <p className="subtitle">Real-time health probes for Docker services</p>
              </div>
              <div className="header-actions">
                <button
                  className="btn btn-outline"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                >
                  <Activity size={16} color={autoRefresh ? '#10b981' : '#9ca3af'} />
                  Auto-refresh: {autoRefresh ? 'ON (5s)' : 'OFF'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={loadHealthData}
                  disabled={healthLoading}
                >
                  <RefreshCw size={16} className={healthLoading ? 'animate-spin' : ''} />
                  Check Status
                </button>
              </div>
            </div>

            {healthError && (
              <div className="notice-box error" style={{ marginBottom: '2rem' }}>
                <strong>Connection Error:</strong> {healthError}
              </div>
            )}

            <section className="cards-grid">
              <StatusCard
                title="Express API"
                icon={Server}
                status={health ? health.services.api.status : 'connecting'}
                metrics={[
                  { label: 'Uptime', value: health ? `${health.uptimeSeconds}s` : '--' },
                  { label: 'Environment', value: health ? health.environment : 'development' },
                  { label: 'Port', value: '5000' }
                ]}
              />

              <StatusCard
                title="PostgreSQL"
                icon={Database}
                status={health ? health.services.database.status : 'connecting'}
                metrics={[
                  {
                    label: 'Latency',
                    value:
                      health?.services.database.latencyMs !== null &&
                      health?.services.database.latencyMs !== undefined
                        ? `${health.services.database.latencyMs} ms`
                        : '--'
                  },
                  { label: 'ORM', value: 'Prisma 5' },
                  { label: 'Hostname', value: 'postgres:5432' }
                ]}
              />

              <StatusCard
                title="Redis"
                icon={Cpu}
                status={health ? health.services.redis.status : 'connecting'}
                metrics={[
                  {
                    label: 'Latency',
                    value:
                      health?.services.redis.latencyMs !== null &&
                      health?.services.redis.latencyMs !== undefined
                        ? `${health.services.redis.latencyMs} ms`
                        : '--'
                  },
                  { label: 'Driver', value: 'ioredis' },
                  { label: 'Hostname', value: 'redis:6379' }
                ]}
              />
            </section>

            <DemoUsers users={demoUsers} loading={authLoading} />
          </div>
        )}
      </main>

      {/* Create Batch Modal */}
      <CreateBatchModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={() => {
          loadBatches();
        }}
        defaultDistrictId={currentUser?.districtId || 'DIST-NORTH-01'}
      />

      <footer className="footer">
        CertiFlow Skilling Certificate Issuance Platform &bull; Phase 2: Batch Management & Concurrency Safety &bull; Last inspected: {lastCheck.toLocaleTimeString()}
      </footer>
    </div>
  );
};

export default App;
