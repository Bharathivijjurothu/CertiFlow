import React from 'react';
import { CheckCircle2, Clock, AlertCircle, ShieldAlert, SkipForward } from 'lucide-react';
import { ReviewProgress, BatchStatus } from '../types/batch';

interface ApprovalProgressStepperProps {
  progress: ReviewProgress | null;
  status: BatchStatus;
  round: number;
}

export const ApprovalProgressStepper: React.FC<ApprovalProgressStepperProps> = ({
  progress,
  status,
  round
}) => {
  if (!progress) {
    return null;
  }

  const { district, quality, state } = progress;

  // Step 1: Submission
  const isSubmitted = status !== 'DRAFT';

  // Step 2: District
  const isDistrictActive = status === 'SUBMITTED' || status === 'DISTRICT_REVIEW';
  const isDistrictDone = district.isComplete;

  // Step 3: Quality
  const isQualityRequired = quality.required;
  const isQualityActive = status === 'QUALITY_REVIEW';
  const isQualityDone = !isQualityRequired || quality.isComplete;

  // Step 4: State
  const isStateActive = status === 'STATE_REVIEW';
  const isStateDone = state.isComplete || status === 'APPROVED';

  return (
    <div className="stepper-card">
      <div className="stepper-header">
        <div className="stepper-title">
          <h3>Approval Workflow Stepper</h3>
          <span className="stepper-round-badge">Round {round}</span>
        </div>
        <div className="stepper-summary-status">
          Status: <strong className={`status-text-${status}`}>{status.replace('_', ' ')}</strong>
        </div>
      </div>

      <div className="stepper-track">
        {/* Step 1: Submission */}
        <div className={`step-item ${isSubmitted ? 'completed' : 'pending'}`}>
          <div className="step-circle">
            {isSubmitted ? <CheckCircle2 size={18} /> : <Clock size={18} />}
          </div>
          <div className="step-content">
            <div className="step-label">1. Batch Submission</div>
            <div className="step-desc">
              {isSubmitted ? 'Submitted by Centre' : 'Draft stage'}
            </div>
          </div>
        </div>

        <div className={`step-connector ${isSubmitted ? 'completed' : ''}`} />

        {/* Step 2: District Review */}
        <div
          className={`step-item ${
            isDistrictDone ? 'completed' : isDistrictActive ? 'active' : 'pending'
          }`}
        >
          <div className="step-circle">
            {isDistrictDone ? (
              <CheckCircle2 size={18} />
            ) : isDistrictActive ? (
              <Clock size={18} className="spin-slow" />
            ) : (
              <Clock size={18} />
            )}
          </div>
          <div className="step-content">
            <div className="step-label">2. District Review</div>
            <div className="step-desc">
              <strong>{district.approvedCount} of {district.required}</strong> Approved
            </div>
            {district.approvals.length > 0 && (
              <div className="step-subtext">
                {district.approvals.map((a, i) => (
                  <span key={i} className="officer-tag">
                    ✓ {a.reviewerName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={`step-connector ${isDistrictDone ? 'completed' : ''}`} />

        {/* Step 3: Quality Review */}
        <div
          className={`step-item ${
            !isQualityRequired
              ? 'skipped'
              : isQualityDone
              ? 'completed'
              : isQualityActive
              ? 'active'
              : 'pending'
          }`}
        >
          <div className="step-circle">
            {!isQualityRequired ? (
              <SkipForward size={18} />
            ) : isQualityDone ? (
              <CheckCircle2 size={18} />
            ) : isQualityActive ? (
              <Clock size={18} className="spin-slow" />
            ) : (
              <Clock size={18} />
            )}
          </div>
          <div className="step-content">
            <div className="step-label">3. Quality Review</div>
            <div className="step-desc">
              {!isQualityRequired ? (
                <span className="badge-skipped">
                  Skipped (&lt; {quality.threshold} students)
                </span>
              ) : isQualityDone && quality.approval ? (
                <span className="officer-tag">✓ {quality.approval.reviewerName}</span>
              ) : (
                <span>Required (&ge; {quality.threshold} students)</span>
              )}
            </div>
          </div>
        </div>

        <div className={`step-connector ${isQualityDone ? 'completed' : ''}`} />

        {/* Step 4: State Final Approval */}
        <div
          className={`step-item ${
            isStateDone ? 'completed' : isStateActive ? 'active' : 'pending'
          }`}
        >
          <div className="step-circle">
            {isStateDone ? (
              <CheckCircle2 size={18} />
            ) : isStateActive ? (
              <Clock size={18} className="spin-slow" />
            ) : (
              <Clock size={18} />
            )}
          </div>
          <div className="step-content">
            <div className="step-label">4. State Final Review</div>
            <div className="step-desc">
              {isStateDone && state.approval ? (
                <span className="officer-tag">✓ {state.approval.reviewerName}</span>
              ) : (
                'Final State Officer Approval'
              )}
            </div>
          </div>
        </div>
      </div>

      {status === 'RETURNED' && (
        <div className="stepper-banner warning">
          <AlertCircle size={18} />
          <div>
            <strong>Batch Returned for Correction in Round {round}.</strong> The Training Centre can update records and resubmit, which will initiate Round {round + 1}.
          </div>
        </div>
      )}

      {status === 'REJECTED' && (
        <div className="stepper-banner danger">
          <ShieldAlert size={18} />
          <div>
            <strong>Batch Rejected.</strong> This batch cannot be approved or processed further.
          </div>
        </div>
      )}

      {status === 'APPROVED' && (
        <div className="stepper-banner success">
          <CheckCircle2 size={18} />
          <div>
            <strong>Batch Approved!</strong> All prerequisite District, Quality, and State Officer approvals have been fully verified. Ready for certificate issuance.
          </div>
        </div>
      )}

      {status === 'PROCESSING' && (
        <div className="stepper-banner active" style={{ backgroundColor: 'rgba(59, 130, 246, 0.12)', borderColor: 'rgba(59, 130, 246, 0.3)', color: '#93c5fd' }}>
          <Clock size={18} className="spin-slow" />
          <div>
            <strong>Generating Certificates in Background...</strong> Rendering PDFs, embedding QR codes, and issuing credentials.
          </div>
        </div>
      )}

      {status === 'ISSUED' && (
        <div className="stepper-banner success" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.35)', color: '#34d399' }}>
          <CheckCircle2 size={18} />
          <div>
            <strong>Official Certificates Issued!</strong> All enrolled candidates have been issued verifiable certificates with embedded QR codes.
          </div>
        </div>
      )}
    </div>
  );
};
