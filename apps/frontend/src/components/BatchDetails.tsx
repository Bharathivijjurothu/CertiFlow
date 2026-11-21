import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Calendar,
  Send,
  CheckCircle,
  RotateCcw,
  XCircle,
  History,
  Users,
  AlertTriangle,
  Edit3,
  FileCheck,
  Award,
  Download,
  Eye,
  Sparkles,
  Clock,
  MessageSquare,
  RefreshCw,
  ShieldAlert
} from 'lucide-react';
import {
  Batch,
  User,
  ReviewDecision,
  ReviewProgress,
  Certificate,
  BatchDeliveryStatusResponse,
  SimulatedWhatsAppMessage
} from '../types/batch';
import {
  submitBatch,
  submitReview,
  fetchReviewProgress,
  generateCertificates,
  fetchBatchCertificates,
  downloadCertificatePdf,
  sendBatchCertificates,
  fetchBatchDeliveryStatus,
  retryCertificateDelivery,
  fetchSimulatedWhatsAppMessages,
  cancelCertificate
} from '../services/api';
import { UploadComponent } from './UploadComponent';
import { ReviewModal } from './ReviewModal';
import { EditBatchModal } from './EditBatchModal';
import { ApprovalProgressStepper } from './ApprovalProgressStepper';
import { CertificatePreviewModal } from './CertificatePreviewModal';
import { CancelCertificateModal } from './CancelCertificateModal';

interface BatchDetailsProps {
  batch: Batch;
  currentUser: User | null;
  onBack: () => void;
  onRefresh: () => void;
}

export const BatchDetails: React.FC<BatchDetailsProps> = ({
  batch,
  currentUser,
  onBack,
  onRefresh
}) => {
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingCerts, setGeneratingCerts] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'students' | 'reviews' | 'history' | 'certificates' | 'delivery'>(
    batch.status === 'ISSUED' ? 'certificates' : 'students'
  );

  // Certificates list & preview modal
  const [certificates, setCertificates] = useState<Certificate[]>(batch.certificates || []);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);
  const [certPreviewOpen, setCertPreviewOpen] = useState(false);

  // Phase 5: WhatsApp Delivery state
  const [deliveryStatus, setDeliveryStatus] = useState<BatchDeliveryStatusResponse | null>(null);
  const [loadingDelivery, setLoadingDelivery] = useState(false);
  const [sendingDelivery, setSendingDelivery] = useState(false);
  const [retryingCertId, setRetryingCertId] = useState<string | null>(null);
  const [simulatedMessages, setSimulatedMessages] = useState<SimulatedWhatsAppMessage[]>([]);
  const [loadingSimMessages, setLoadingSimMessages] = useState(false);

  // Review & Edit Modals state
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [certToCancel, setCertToCancel] = useState<Certificate | null>(null);
  const [modalDecision, setModalDecision] = useState<ReviewDecision>('APPROVED');
  const [modalActionName, setModalActionName] = useState('Approve Batch');

  // Load Review Workflow Progress
  const loadProgress = async () => {
    try {
      const data = await fetchReviewProgress(batch.id);
      setProgress(data);
    } catch (err) {
      console.error('Failed to load review progress:', err);
    }
  };

  // Load Certificates
  const loadCertificates = async () => {
    try {
      const certs = await fetchBatchCertificates(batch.id);
      setCertificates(certs);
    } catch (err) {
      console.error('Failed to load certificates:', err);
    }
  };

  // Load Delivery Status
  const loadDeliveryStatus = async () => {
    if (batch.status !== 'ISSUED') return;
    try {
      setLoadingDelivery(true);
      const data = await fetchBatchDeliveryStatus(batch.id);
      setDeliveryStatus(data);
    } catch (err) {
      console.error('Failed to load delivery status:', err);
    } finally {
      setLoadingDelivery(false);
    }
  };

  // Load WhatsApp Simulator messages
  const loadSimulatedMessages = async () => {
    try {
      setLoadingSimMessages(true);
      const data = await fetchSimulatedWhatsAppMessages();
      setSimulatedMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load simulated messages:', err);
    } finally {
      setLoadingSimMessages(false);
    }
  };

  useEffect(() => {
    loadProgress();
    if (batch.status === 'APPROVED' || batch.status === 'PROCESSING' || batch.status === 'ISSUED') {
      loadCertificates();
    }
    if (batch.status === 'ISSUED') {
      loadDeliveryStatus();
      loadSimulatedMessages();
    }
  }, [batch.id, batch.version, batch.status]);

  const isTrainingCentre = currentUser?.role === 'TRAINING_CENTRE';
  const isDistrictOfficer = currentUser?.role === 'DISTRICT_OFFICER';
  const isQualityOfficer = currentUser?.role === 'QUALITY_OFFICER';
  const isStateOfficer = currentUser?.role === 'STATE_OFFICER';

  const isOwnerCentre = isTrainingCentre && batch.trainingCentreId === currentUser?.trainingCentreId;
  const isAssignedDistrict = isDistrictOfficer && batch.districtId === currentUser?.districtId;
  const isCreatorConflict = isDistrictOfficer && currentUser?.id === batch.createdById;

  const canUpload = isOwnerCentre && (batch.status === 'DRAFT' || batch.status === 'RETURNED');
  const canSubmit = isOwnerCentre && (batch.status === 'DRAFT' || batch.status === 'RETURNED') && (batch.studentCount ?? 0) > 0;

  // District Review eligibility
  const isDistrictReviewActive = batch.status === 'SUBMITTED' || batch.status === 'DISTRICT_REVIEW';
  const alreadyApprovedByCurrentUser = progress?.district.alreadyApprovedByCurrentUser || false;
  const canDistrictReview = isAssignedDistrict && isDistrictReviewActive && !isCreatorConflict;

  // Quality Review eligibility
  const canQualityReview = isQualityOfficer && batch.status === 'QUALITY_REVIEW';

  // State Review eligibility
  const canStateReview = isStateOfficer && batch.status === 'STATE_REVIEW';

  // State Certificate Generation eligibility
  const canGenerateCertificates = isStateOfficer && (batch.status === 'APPROVED' || batch.status === 'PROCESSING');

  // Submit batch (DRAFT/RETURNED -> SUBMITTED)
  const handleSubmitBatch = async () => {
    const isResubmit = batch.status === 'RETURNED';
    const confirmMsg = isResubmit
      ? `Resubmit batch '${batch.batchNumber}' for District Review? This will begin Approval Round ${(batch.approvalRound || 1) + 1}.`
      : `Submit batch '${batch.batchNumber}' for District Review?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSubmitting(true);
      setActionError(null);
      setActionSuccess(null);

      await submitBatch(batch.id, batch.version);
      setActionSuccess(
        isResubmit
          ? `Batch successfully resubmitted. Approval Round ${(batch.approvalRound || 1) + 1} initiated.`
          : 'Batch successfully submitted for District Officer review.'
      );
      onRefresh();
      loadProgress();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit batch');
    } finally {
      setSubmitting(false);
    }
  };

  // Open modal for approve / return / reject
  const openDecisionModal = (decision: ReviewDecision, actionName: string) => {
    setModalDecision(decision);
    setModalActionName(actionName);
    setReviewModalOpen(true);
  };

  // Handle Review Decision submit
  const handleReviewDecision = async (comment: string) => {
    try {
      setSubmitting(true);
      setActionError(null);
      setActionSuccess(null);

      const res = await submitReview(batch.id, {
        expectedVersion: batch.version,
        decision: modalDecision,
        comment
      });

      setActionSuccess(`Review decision '${modalDecision}' successfully recorded. Next status: ${res.nextStatus}`);
      onRefresh();
      loadProgress();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit review decision');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Certificate Generation
  const handleGenerateCertificates = async () => {
    if (!window.confirm(`Generate official certificates for all enrolled students in batch '${batch.batchNumber}'?`)) return;

    try {
      setGeneratingCerts(true);
      setActionError(null);
      setActionSuccess(null);

      const res = await generateCertificates(batch.id);
      setActionSuccess(res.message || 'Certificates successfully generated and issued!');
      onRefresh();
      await loadCertificates();
      setActiveTab('certificates');
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate certificates');
    } finally {
      setGeneratingCerts(false);
    }
  };

  const handleDownloadSingleCert = async (cert: Certificate) => {
    try {
      await downloadCertificatePdf(cert.id, cert.certificateNumber);
    } catch (err: any) {
      setActionError(err.message || 'Failed to download certificate PDF');
    }
  };

  // Phase 5: WhatsApp Delivery handlers
  const canSendDelivery = (isOwnerCentre || isStateOfficer || isAssignedDistrict) && batch.status === 'ISSUED';

  const handleSendCertificates = async () => {
    if (!window.confirm(`Queue simulated WhatsApp certificate notifications for batch '${batch.batchNumber}'?`)) return;

    try {
      setSendingDelivery(true);
      setActionError(null);
      setActionSuccess(null);

      const res = await sendBatchCertificates(batch.id);
      setActionSuccess(`WhatsApp certificate delivery initiated! Queued: ${res.queuedCount}, Already Sent: ${res.alreadySentCount}, Total: ${res.totalEligible}`);
      await loadDeliveryStatus();
      await loadSimulatedMessages();
      setActiveTab('delivery');
    } catch (err: any) {
      setActionError(err.message || 'Failed to trigger certificate delivery');
    } finally {
      setSendingDelivery(false);
    }
  };

  const handleRetryDelivery = async (certificateId: string) => {
    try {
      setRetryingCertId(certificateId);
      setActionError(null);
      setActionSuccess(null);

      await retryCertificateDelivery(certificateId);
      setActionSuccess('Manual delivery retry completed successfully!');
      await loadDeliveryStatus();
      await loadSimulatedMessages();
    } catch (err: any) {
      setActionError(err.message || 'Failed to retry delivery');
    } finally {
      setRetryingCertId(null);
    }
  };

  // Phase 6: Certificate Cancellation Handler (State Officer only)
  const handleCancelCertificate = async (reason: string) => {
    if (!certToCancel) return;
    try {
      setActionError(null);
      setActionSuccess(null);
      const res = await cancelCertificate(certToCancel.id, reason);
      setActionSuccess(res.message || `Certificate ${certToCancel.certificateNumber} successfully cancelled.`);
      await loadCertificates();
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel certificate');
      throw err;
    }
  };

  return (
    <div className="batch-details-container">
      {/* Top Breadcrumb & Lock Info */}
      <div className="details-header-nav">
        <button className="btn btn-outline btn-sm" onClick={onBack}>
          <ArrowLeft size={14} /> Back to Batches
        </button>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span className="badge-round">
            Approval Round: <strong>{batch.approvalRound || 1}</strong>
          </span>
          <span className="concurrency-badge">
            Optimistic Lock: Version {batch.version}
          </span>
        </div>
      </div>

      {actionSuccess && (
        <div className="notice-box success">
          <CheckCircle size={18} />
          <div>{actionSuccess}</div>
        </div>
      )}

      {actionError && (
        <div className="notice-box error">
          <AlertTriangle size={18} />
          <div>
            <strong>Action Error:</strong> {actionError}
          </div>
        </div>
      )}

      {/* Main Info Card */}
      <div className="details-card">
        <div className="details-card-top">
          <div>
            <div className="batch-title-row">
              <h2>{batch.batchName}</h2>
              <code className="batch-code-large">{batch.batchNumber}</code>
              <span className={`batch-status-badge status-${batch.status}`}>
                {batch.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="course-name">{batch.courseName}</p>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="actions-toolbar">
            {/* Training Centre: Edit Metadata */}
            {canUpload && (
              <button
                className="btn btn-outline"
                onClick={() => setEditModalOpen(true)}
                disabled={submitting}
              >
                <Edit3 size={15} /> Edit Batch
              </button>
            )}

            {/* Training Centre: Submit / Resubmit */}
            {canSubmit && (
              <button
                className="btn btn-primary"
                onClick={handleSubmitBatch}
                disabled={submitting}
              >
                <Send size={16} />
                {submitting ? 'Submitting...' : batch.status === 'RETURNED' ? 'Resubmit Batch' : 'Submit Batch'}
              </button>
            )}

            {/* District Officer Review Actions */}
            {canDistrictReview && (
              <>
                {alreadyApprovedByCurrentUser ? (
                  <div className="already-approved-badge">
                    <CheckCircle size={15} color="#10b981" />
                    <span>You approved in Round {batch.approvalRound || 1} (Waiting for 2nd DO)</span>
                  </div>
                ) : (
                  <>
                    <button
                      className="btn btn-success"
                      onClick={() => openDecisionModal('APPROVED', 'Approve (District Review)')}
                      disabled={submitting}
                    >
                      <CheckCircle size={16} /> Approve (District)
                    </button>
                    <button
                      className="btn btn-warning"
                      onClick={() => openDecisionModal('RETURNED', 'Return to Centre')}
                      disabled={submitting}
                    >
                      <RotateCcw size={16} /> Return
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => openDecisionModal('REJECTED', 'Reject Batch')}
                      disabled={submitting}
                    >
                      <XCircle size={16} /> Reject
                    </button>
                  </>
                )}
              </>
            )}

            {isCreatorConflict && isDistrictReviewActive && (
              <span className="badge-warning-inline">
                Self-Approval Blocked (You created this batch)
              </span>
            )}

            {/* Quality Officer Actions */}
            {canQualityReview && (
              <>
                <button
                  className="btn btn-success"
                  onClick={() => openDecisionModal('APPROVED', 'Approve Quality Review')}
                  disabled={submitting}
                >
                  <CheckCircle size={16} /> Approve Quality Review
                </button>
                <button
                  className="btn btn-warning"
                  onClick={() => openDecisionModal('RETURNED', 'Return to Centre')}
                  disabled={submitting}
                >
                  <RotateCcw size={16} /> Return
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => openDecisionModal('REJECTED', 'Reject Batch')}
                  disabled={submitting}
                >
                  <XCircle size={16} /> Reject
                </button>
              </>
            )}

            {/* State Officer Actions: Review Approval */}
            {canStateReview && (
              <>
                <button
                  className="btn btn-success"
                  onClick={() => openDecisionModal('APPROVED', 'Final State Approval')}
                  disabled={submitting}
                >
                  <CheckCircle size={16} /> Final State Approval
                </button>
                <button
                  className="btn btn-warning"
                  onClick={() => openDecisionModal('RETURNED', 'Return to Centre')}
                  disabled={submitting}
                >
                  <RotateCcw size={16} /> Return
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => openDecisionModal('REJECTED', 'Reject Batch')}
                  disabled={submitting}
                >
                  <XCircle size={16} /> Reject
                </button>
              </>
            )}

            {/* Phase 4: State Officer Certificate Generation */}
            {canGenerateCertificates && (
              <button
                className="btn btn-primary"
                onClick={handleGenerateCertificates}
                disabled={generatingCerts || submitting}
              >
                <Sparkles size={16} />
                {generatingCerts ? 'Generating Certificates...' : 'Generate Official Certificates'}
              </button>
            )}

            {batch.status === 'PROCESSING' && !isStateOfficer && (
              <div className="status-chip processing">
                <Clock size={14} className="spin-slow" />
                <span>Certificate Generation in Progress...</span>
              </div>
            )}

            {batch.status === 'ISSUED' && (
              <>
                <div className="status-chip issued">
                  <Award size={16} color="#10b981" />
                  <span>All Certificates Issued</span>
                </div>
                {canSendDelivery && (
                  <button
                    className="btn btn-primary"
                    onClick={handleSendCertificates}
                    disabled={sendingDelivery}
                    style={{ background: '#25d366', borderColor: '#25d366', color: '#0f172a', fontWeight: 600 }}
                  >
                    <MessageSquare size={16} />
                    {sendingDelivery ? 'Queueing Delivery...' : 'Deliver via WhatsApp'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="meta-grid">
          <div className="meta-item">
            <span className="label">Training Centre:</span>
            <span className="val"><code>{batch.trainingCentreId}</code></span>
          </div>
          <div className="meta-item">
            <span className="label">District:</span>
            <span className="val"><code>{batch.districtId}</code></span>
          </div>
          <div className="meta-item">
            <span className="label">Training Period:</span>
            <span className="val">
              <Calendar size={14} style={{ display: 'inline', marginRight: 4 }} />
              {new Date(batch.trainingStartDate).toLocaleDateString()} &mdash;{' '}
              {new Date(batch.trainingEndDate).toLocaleDateString()}
            </span>
          </div>
          <div className="meta-item">
            <span className="label">Students:</span>
            <span className="val"><strong>{batch.studentCount ?? batch.students?.length ?? 0} enrolled</strong></span>
          </div>
        </div>
      </div>

      {/* Approval Workflow Stepper */}
      <ApprovalProgressStepper
        progress={progress}
        status={batch.status}
        round={batch.approvalRound || 1}
      />

      {/* Student Upload Section (Visible for TC when DRAFT or RETURNED) */}
      {canUpload && (
        <div className="section" style={{ marginTop: '2rem' }}>
          <UploadComponent
            batchId={batch.id}
            onUploadSuccess={() => {
              onRefresh();
              loadProgress();
            }}
          />
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="details-tabs-header" style={{ marginTop: '2.5rem' }}>
        <button
          className={`tab-btn ${activeTab === 'students' ? 'active' : ''}`}
          onClick={() => setActiveTab('students')}
        >
          <Users size={16} />
          <span>Enrolled Students ({batch.students?.length ?? 0})</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'reviews' ? 'active' : ''}`}
          onClick={() => setActiveTab('reviews')}
        >
          <FileCheck size={16} />
          <span>Review Decisions ({batch.reviews?.length ?? 0})</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'certificates' ? 'active' : ''}`}
          onClick={() => setActiveTab('certificates')}
        >
          <Award size={16} />
          <span>Certificates ({certificates.length})</span>
        </button>
        {batch.status === 'ISSUED' && (
          <button
            className={`tab-btn ${activeTab === 'delivery' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('delivery');
              loadDeliveryStatus();
              loadSimulatedMessages();
            }}
          >
            <MessageSquare size={16} />
            <span>WhatsApp Delivery</span>
            {deliveryStatus && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'rgba(37, 211, 102, 0.2)',
                  color: '#25d366',
                  fontWeight: 700
                }}
              >
                {deliveryStatus.stats.sent}/{deliveryStatus.totalEligible}
              </span>
            )}
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={16} />
          <span>Audit History ({batch.history?.length ?? 0})</span>
        </button>
      </div>

      {/* Tab 1: Enrolled Students */}
      {activeTab === 'students' && (
        <div className="section-tab-content">
          {!batch.students || batch.students.length === 0 ? (
            <div className="empty-state">
              <p>No students enrolled yet. Upload a student Excel/CSV sheet above.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Student Name</th>
                    <th>Email Address</th>
                    <th>Phone Number</th>
                    <th>Govt ID</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.students.map((student) => (
                    <tr key={student.id}>
                      <td><code>{student.studentId || 'N/A'}</code></td>
                      <td style={{ fontWeight: 600 }}>{student.studentName}</td>
                      <td><code style={{ color: '#93c5fd' }}>{student.email}</code></td>
                      <td>{student.phone}</td>
                      <td><code>{student.governmentId || '---'}</code></td>
                      <td>{student.grade || '---'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Review Decisions Log */}
      {activeTab === 'reviews' && (
        <div className="section-tab-content">
          {!batch.reviews || batch.reviews.length === 0 ? (
            <div className="empty-state">
              <p>No review decisions have been recorded yet.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Stage</th>
                    <th>Decision</th>
                    <th>Reviewer</th>
                    <th>Role</th>
                    <th>Reason / Comment</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.reviews.map((rev) => (
                    <tr key={rev.id}>
                      <td>
                        <span className="badge-round-sm">Round {rev.round}</span>
                      </td>
                      <td>
                        <span className="stage-tag">{rev.stage}</span>
                      </td>
                      <td>
                        <span className={`decision-tag decision-${rev.decision}`}>
                          {rev.decision}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {rev.reviewer?.name || rev.reviewerId}
                      </td>
                      <td>
                        <code style={{ fontSize: '0.8rem' }}>{rev.reviewerRole}</code>
                      </td>
                      <td style={{ maxWidth: '300px' }}>
                        {rev.comment ? (
                          <span>&ldquo;{rev.comment}&rdquo;</span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>&mdash;</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {new Date(rev.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Issued Certificates (Phase 4) */}
      {activeTab === 'certificates' && (
        <div className="section-tab-content">
          {certificates.length === 0 ? (
            <div className="empty-state">
              <Award size={36} color="#94a3b8" />
              <p style={{ marginTop: '0.5rem' }}>
                {batch.status === 'APPROVED' && isStateOfficer
                  ? 'Batch is approved! Click "Generate Official Certificates" in the top toolbar to issue certificates.'
                  : batch.status === 'APPROVED'
                  ? 'Batch is approved. Waiting for State Officer to generate official certificates.'
                  : 'Certificates can only be issued once the batch has received final approval.'}
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Certificate Number</th>
                    <th>Student Name</th>
                    <th>Masked Phone</th>
                    <th>Issue Date</th>
                    <th>Status</th>
                    <th>WhatsApp Delivery</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((cert) => {
                    const del = deliveryStatus?.deliveries.find((d) => d.certificateId === cert.id);
                    return (
                      <tr key={cert.id}>
                        <td>
                          <code className="batch-code" style={{ color: '#38bdf8' }}>
                            {cert.certificateNumber}
                          </code>
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {cert.student?.studentName || 'Student'}
                        </td>
                        <td>
                          <code style={{ color: '#93c5fd' }}>
                            {del?.maskedPhone || '98****' + (cert.student?.phone?.slice(-4) || '0000')}
                          </code>
                        </td>
                        <td>{new Date(cert.issueDate).toLocaleDateString()}</td>
                        <td>
                          <span className="cert-status-pill">{cert.status}</span>
                        </td>
                        <td>
                          {del ? (
                            <span className={`delivery-status-badge ${del.status.toLowerCase()}`}>
                              {del.status === 'SENT' ? 'Sent' : del.status === 'FAILED' ? `Failed (${del.attempts}/3)` : del.status}
                            </span>
                          ) : (
                            <span className="delivery-status-badge pending">Pending</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSelectedCert(cert);
                                setCertPreviewOpen(true);
                              }}
                            >
                              <Eye size={13} /> Preview
                            </button>
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => handleDownloadSingleCert(cert)}
                            >
                              <Download size={13} /> PDF
                            </button>
                            {isStateOfficer && cert.status !== 'CANCELLED' && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  setCertToCancel(cert);
                                  setCancelModalOpen(true);
                                }}
                                title="Cancel this certificate (State Officer authority)"
                              >
                                <ShieldAlert size={13} /> Cancel
                              </button>
                            )}
                            {del?.status === 'FAILED' && (
                              <button
                                className="btn btn-warning btn-sm"
                                onClick={() => handleRetryDelivery(cert.id)}
                                disabled={retryingCertId === cert.id}
                              >
                                <RotateCcw size={13} /> Retry
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: WhatsApp Certificate Delivery (Phase 5) */}
      {activeTab === 'delivery' && (
        <div className="section-tab-content">
          {/* Simulator Notice */}
          <div className="simulator-notice-card">
            <MessageSquare size={24} color="#25d366" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <strong style={{ color: '#25d366' }}>WhatsApp Notification Simulator (Hackathon Demo)</strong>
                <span className="badge-round-sm" style={{ background: 'rgba(37, 211, 102, 0.2)', color: '#25d366' }}>Active</span>
              </div>
              <p>
                CertiFlow delivers official credential notifications directly to student WhatsApp numbers via an asynchronous queue. In this hackathon environment, simulated dispatches are processed with deterministic retry policies, exponential backoff, and recipient phone masking (<code>98****3210</code>) for student privacy.
              </p>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="delivery-metrics-grid">
            <div className="delivery-stat-card">
              <div className="delivery-stat-icon total">
                <Users size={20} />
              </div>
              <div className="delivery-stat-content">
                <h4>{deliveryStatus?.totalEligible ?? certificates.length}</h4>
                <p>Eligible Students</p>
              </div>
            </div>

            <div className="delivery-stat-card">
              <div className="delivery-stat-icon sent">
                <CheckCircle size={20} />
              </div>
              <div className="delivery-stat-content">
                <h4 style={{ color: '#34d399' }}>{deliveryStatus?.stats.sent ?? 0}</h4>
                <p>Delivered via WhatsApp</p>
              </div>
            </div>

            <div className="delivery-stat-card">
              <div className="delivery-stat-icon queued">
                <Clock size={20} />
              </div>
              <div className="delivery-stat-content">
                <h4 style={{ color: '#fbbf24' }}>
                  {(deliveryStatus?.stats.queued ?? 0) + (deliveryStatus?.stats.processing ?? 0)}
                </h4>
                <p>Queued / In Progress</p>
              </div>
            </div>

            <div className="delivery-stat-card">
              <div className="delivery-stat-icon failed">
                <XCircle size={20} />
              </div>
              <div className="delivery-stat-content">
                <h4 style={{ color: '#f87171' }}>{deliveryStatus?.stats.failed ?? 0}</h4>
                <p>Delivery Failures</p>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Student Delivery Tracking</h3>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  loadDeliveryStatus();
                  loadSimulatedMessages();
                }}
                disabled={loadingDelivery}
              >
                <RefreshCw size={14} className={loadingDelivery ? 'spin-slow' : ''} /> Refresh Status
              </button>
              {canSendDelivery && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSendCertificates}
                  disabled={sendingDelivery}
                  style={{ background: '#25d366', borderColor: '#25d366', color: '#0f172a', fontWeight: 600 }}
                >
                  <Send size={14} /> Send to All Unsent
                </button>
              )}
            </div>
          </div>

          {/* Deliveries Table */}
          {!deliveryStatus || deliveryStatus.deliveries.length === 0 ? (
            <div className="empty-state">
              <MessageSquare size={36} color="#94a3b8" />
              <p>No delivery records yet. Click &ldquo;Deliver via WhatsApp&rdquo; to begin notification dispatch.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Masked Phone</th>
                    <th>Certificate Number</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Last Attempt / Sent At</th>
                    <th>Error Detail</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryStatus.deliveries.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.studentName}</td>
                      <td>
                        <code style={{ color: '#93c5fd' }}>{item.maskedPhone}</code>
                      </td>
                      <td>
                        <code className="batch-code" style={{ color: '#38bdf8' }}>
                          {item.certificateNumber}
                        </code>
                      </td>
                      <td>
                        <span className={`delivery-status-badge ${item.status.toLowerCase()}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        <span>
                          {item.attempts} / {item.maxAttempts}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                        {item.sentAt
                          ? new Date(item.sentAt).toLocaleString()
                          : item.lastAttemptAt
                          ? new Date(item.lastAttemptAt).toLocaleString()
                          : 'Not attempted'}
                      </td>
                      <td style={{ maxWidth: '240px', fontSize: '0.8rem' }}>
                        {item.errorMessage ? (
                          <span style={{ color: '#f87171' }}>{item.errorMessage}</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>&mdash;</span>
                        )}
                      </td>
                      <td>
                        {item.status === 'FAILED' && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleRetryDelivery(item.certificateId)}
                            disabled={retryingCertId === item.certificateId}
                          >
                            <RotateCcw size={13} />
                            {retryingCertId === item.certificateId ? 'Retrying...' : 'Retry'}
                          </button>
                        )}
                        {item.status === 'SENT' && (
                          <span style={{ color: '#34d399', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle size={13} /> Delivered
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Simulator Message Log */}
          <div style={{ marginTop: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                Live WhatsApp Simulator Messages ({simulatedMessages.length})
              </h3>
              <button
                className="btn btn-outline btn-sm"
                onClick={loadSimulatedMessages}
                disabled={loadingSimMessages}
              >
                <RefreshCw size={13} /> Refresh Log
              </button>
            </div>

            {simulatedMessages.length === 0 ? (
              <div className="empty-state">
                <p>No simulated WhatsApp messages recorded in this session.</p>
              </div>
            ) : (
              <div className="simulator-ledger">
                {simulatedMessages.map((msg) => (
                  <div
                    key={msg.messageId}
                    className={`simulator-bubble ${msg.status === 'FAILED' ? 'failed' : ''}`}
                  >
                    <div className="bubble-meta">
                      <span>
                        To: <strong>{msg.studentName}</strong> (<code>{msg.maskedPhone}</code>) &bull; Cert: <code>{msg.certificateNumber}</code>
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className={`delivery-status-badge ${msg.status.toLowerCase()}`}>
                          {msg.status}
                        </span>
                        <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="bubble-text">{msg.body}</div>
                    {msg.error && (
                      <div style={{ marginTop: '0.4rem', color: '#f87171', fontSize: '0.78rem' }}>
                        Error: {msg.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Full Audit History */}
      {activeTab === 'history' && (
        <div className="section-tab-content">
          {!batch.history || batch.history.length === 0 ? (
            <div className="empty-state">
              <p>No audit events recorded yet.</p>
            </div>
          ) : (
            <div className="history-timeline">
              {batch.history.map((item) => (
                <div key={item.id} className="timeline-item">
                  <div className="timeline-marker" />
                  <div className="timeline-content">
                    <div className="timeline-header">
                      <span className="timeline-action">{item.action.replace(/_/g, ' ')}</span>
                      <span className="timeline-time">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="timeline-transition">
                      <span className={`batch-status-badge status-${item.fromStatus}`}>
                        {item.fromStatus}
                      </span>
                      <span className="arrow">&rarr;</span>
                      <span className={`batch-status-badge status-${item.toStatus}`}>
                        {item.toStatus}
                      </span>
                    </div>
                    <div className="timeline-actor">
                      By: <strong>{item.user.name}</strong> ({item.user.role})
                    </div>
                    {item.reason && (
                      <div className="timeline-reason">
                        &ldquo;{item.reason}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phase 3 Review Modal */}
      <ReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        decision={modalDecision}
        actionTitle={modalActionName}
        onConfirm={handleReviewDecision}
      />

      {/* Phase 4 Certificate Preview Modal */}
      <CertificatePreviewModal
        isOpen={certPreviewOpen}
        onClose={() => {
          setCertPreviewOpen(false);
          setSelectedCert(null);
        }}
        certificate={selectedCert}
      />

      {/* Edit Batch Modal */}
      <EditBatchModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        batch={batch}
        onUpdated={() => {
          onRefresh();
          loadProgress();
        }}
      />

      {/* Phase 6 State Officer Certificate Cancellation Modal */}
      <CancelCertificateModal
        isOpen={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCertToCancel(null);
        }}
        certificate={certToCancel}
        onConfirm={handleCancelCertificate}
      />
    </div>
  );
};
