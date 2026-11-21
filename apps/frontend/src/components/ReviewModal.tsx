import React, { useState } from 'react';
import { X, CheckCircle, RotateCcw, XCircle } from 'lucide-react';
import { ReviewDecision } from '../types/batch';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: ReviewDecision;
  actionTitle: string;
  onConfirm: (comment: string) => Promise<void>;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  decision,
  actionTitle,
  onConfirm
}) => {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isReturn = decision === 'RETURNED';
  const isReject = decision === 'REJECTED';
  const isApprove = decision === 'APPROVED';
  const isMandatoryComment = isReturn || isReject;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMandatoryComment && !comment.trim()) {
      setError(`A non-empty comment is required when ${decision.toLowerCase()} a batch.`);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onConfirm(comment.trim());
      setComment('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>
            {isApprove && 'Confirm Approval'}
            {isReturn && 'Return Batch for Correction'}
            {isReject && 'Reject Batch'}
          </h2>
          <button className="close-btn" onClick={onClose} disabled={submitting}>
            <X size={20} />
          </button>
        </div>

        {error && <div className="notice-box error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem', lineHeight: '1.4' }}>
            {isApprove && 'You are recording your formal approval for this batch. Prerequisite stages and distinct officer requirements will be enforced.'}
            {isReturn && 'Returning this batch sends it back to the Training Centre for correction. The next submission will begin a fresh approval round, while all review history remains preserved.'}
            {isReject && 'Rejecting this batch is final. The batch cannot be approved or processed further.'}
          </p>

          <div className="form-group">
            <label>
              {isMandatoryComment ? 'Reason / Correction Instructions *' : 'Review Notes (Optional)'}
            </label>
            <textarea
              required={isMandatoryComment}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                isReturn
                  ? 'e.g. Please verify student phone numbers and update attendance records.'
                  : isReject
                  ? 'e.g. Batch documents fail foundational criteria.'
                  : 'Add optional approval notes or remarks...'
              }
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${isApprove ? 'btn-success' : isReturn ? 'btn-warning' : 'btn-danger'}`}
              disabled={submitting}
            >
              {isApprove && <CheckCircle size={16} />}
              {isReturn && <RotateCcw size={16} />}
              {isReject && <XCircle size={16} />}
              {submitting ? 'Submitting...' : actionTitle}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
