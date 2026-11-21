import React, { useState } from 'react';
import { AlertTriangle, X, ShieldAlert } from 'lucide-react';
import { Certificate } from '../types/batch';

interface CancelCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificate: Certificate | null;
  onConfirm: (reason: string) => Promise<void>;
}

export const CancelCertificateModal: React.FC<CancelCertificateModalProps> = ({
  isOpen,
  onClose,
  certificate,
  onConfirm
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !certificate) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = reason.trim();
    if (!clean || clean.length < 5) {
      setError('Please provide a descriptive reason of at least 5 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onConfirm(clean);
      setReason('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel certificate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldAlert size={22} color="#ef4444" />
            <h3 style={{ margin: 0 }}>Cancel Official Certificate</h3>
          </div>
          <button className="btn-close" onClick={onClose} disabled={submitting}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="notice-box error" style={{ marginBottom: '1.25rem' }}>
              <AlertTriangle size={20} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.85rem' }}>
                <strong>Permanent Invalidation:</strong> Cancelling this credential will immediately mark it as <code>CANCELLED</code> in public verification lookups, audit logs, and registry searches.
              </div>
            </div>

            <div style={{ background: 'var(--bg-secondary)', padding: '0.85rem 1rem', borderRadius: '0.5rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <div>Certificate Number: <code style={{ color: '#38bdf8' }}>{certificate.certificateNumber}</code></div>
              <div>Student: <strong>{certificate.student?.studentName || 'Student'}</strong></div>
              <div>Course: <span>{certificate.courseName}</span></div>
            </div>

            {error && (
              <div className="notice-box error" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="cancel-reason">
                Official Cancellation Reason <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                id="cancel-reason"
                rows={3}
                placeholder="State the audit finding, disciplinary action, or assessment discrepancy justifying cancellation..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '0.375rem', background: '#0f172a', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.85rem' }}
                autoFocus
              />
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Minimum 5 characters. This reason is immutably recorded in the certificate audit log and displayed upon public verification.
              </div>
            </div>
          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>
              Keep Certificate Valid
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={submitting || reason.trim().length < 5}
            >
              {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
