import React, { useState } from 'react';
import { PlusCircle, Eye, Layers, Clock, ShieldCheck } from 'lucide-react';
import { Batch, BatchStatus, User } from '../types/batch';

interface BatchListProps {
  batches: Batch[];
  loading: boolean;
  currentUser: User | null;
  onSelectBatch: (batchId: string) => void;
  onOpenCreateModal: () => void;
  statusFilter: BatchStatus | 'ALL' | 'PENDING_REVIEW';
  onStatusFilterChange: (status: BatchStatus | 'ALL' | 'PENDING_REVIEW') => void;
}

const BASE_TABS: (BatchStatus | 'ALL')[] = [
  'ALL',
  'DRAFT',
  'SUBMITTED',
  'DISTRICT_REVIEW',
  'QUALITY_REVIEW',
  'STATE_REVIEW',
  'APPROVED',
  'RETURNED',
  'REJECTED'
];

export const BatchList: React.FC<BatchListProps> = ({
  batches,
  loading,
  currentUser,
  onSelectBatch,
  onOpenCreateModal,
  statusFilter,
  onStatusFilterChange
}) => {
  const [search, setSearch] = useState('');

  const isTrainingCentre = currentUser?.role === 'TRAINING_CENTRE';
  const isOfficer = !isTrainingCentre && !!currentUser;

  const filteredBatches = batches.filter((b) => {
    let matchesStatus = true;
    if (statusFilter === 'PENDING_REVIEW') {
      if (currentUser?.role === 'DISTRICT_OFFICER') {
        matchesStatus = (b.status === 'SUBMITTED' || b.status === 'DISTRICT_REVIEW') && b.districtId === currentUser.districtId;
      } else if (currentUser?.role === 'QUALITY_OFFICER') {
        matchesStatus = b.status === 'QUALITY_REVIEW';
      } else if (currentUser?.role === 'STATE_OFFICER') {
        matchesStatus = b.status === 'STATE_REVIEW';
      }
    } else if (statusFilter !== 'ALL') {
      matchesStatus = b.status === statusFilter;
    }

    const matchesSearch =
      b.batchNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.batchName.toLowerCase().includes(search.toLowerCase()) ||
      b.courseName.toLowerCase().includes(search.toLowerCase()) ||
      b.districtId.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="batch-list-section">
      <div className="section-header">
        <div>
          <h2>Training Batches</h2>
          <p className="subtitle">
            {isTrainingCentre
              ? `Manage batches for your centre (${currentUser?.trainingCentreId || 'Assigned'})`
              : currentUser?.role === 'DISTRICT_OFFICER'
              ? `District review queue (${currentUser.districtId})`
              : currentUser?.role === 'QUALITY_OFFICER'
              ? 'Quality review queue (Batches with \u2265 50 students)'
              : 'State-wide final approval oversight'}
          </p>
        </div>

        {isTrainingCentre && (
          <button className="btn btn-primary" onClick={onOpenCreateModal}>
            <PlusCircle size={16} />
            Create New Batch
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="tabs-container">
        <div className="status-tabs">
          {isOfficer && (
            <button
              className={`tab-btn highlight-tab ${statusFilter === 'PENDING_REVIEW' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('PENDING_REVIEW')}
            >
              <ShieldCheck size={14} style={{ display: 'inline', marginRight: 4 }} />
              Action Required
            </button>
          )}

          {BASE_TABS.map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${statusFilter === tab ? 'active' : ''}`}
              onClick={() => onStatusFilterChange(tab)}
            >
              {tab.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="search-bar">
          <input
            type="text"
            placeholder="Search by code, course, district..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <Clock size={24} className="animate-spin" />
          <span>Loading batches from database...</span>
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="empty-state">
          <Layers size={36} color="#9ca3af" />
          <p>No batches found matching current filters.</p>
          {isTrainingCentre && statusFilter === 'ALL' && (
            <button className="btn btn-primary" onClick={onOpenCreateModal} style={{ marginTop: '1rem' }}>
              Create your first batch
            </button>
          )}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="batch-table">
            <thead>
              <tr>
                <th>Batch Code</th>
                <th>Batch & Course Name</th>
                <th>Centre & District</th>
                <th>Training Dates</th>
                <th>Round & Status</th>
                <th>Students</th>
                <th>Version</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <code className="batch-code">{batch.batchNumber}</code>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{batch.batchName}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {batch.courseName}
                    </div>
                  </td>
                  <td>
                    <div><code>{batch.trainingCentreId}</code></div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {batch.districtId}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(batch.trainingStartDate).toLocaleDateString()} &rarr;{' '}
                    {new Date(batch.trainingEndDate).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                      <span className={`batch-status-badge status-${batch.status}`}>
                        {batch.status.replace(/_/g, ' ')}
                      </span>
                      <span className="badge-round-sm">
                        Round {batch.approvalRound || 1}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="student-count-chip">
                      {batch.studentCount ?? 0} students
                    </span>
                  </td>
                  <td>
                    <span className="version-pill">v{batch.version}</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => onSelectBatch(batch.id)}
                    >
                      <Eye size={14} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
