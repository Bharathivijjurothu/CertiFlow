import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  QrCode,
  Calendar,
  Award,
  Building2,
  MapPin,
  Lock,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { verifyCertificatePublic } from '../services/api';
import { PublicVerificationResult } from '../types/batch';

interface PublicVerificationProps {
  initialIdentifier?: string;
  onNavigateHome?: () => void;
}

export const PublicVerification: React.FC<PublicVerificationProps> = ({
  initialIdentifier,
  onNavigateHome
}) => {
  const [identifier, setIdentifier] = useState(initialIdentifier || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PublicVerificationResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Auto-verify if initial identifier provided via URL or prop
  useEffect(() => {
    // Check URL parameters if no prop passed
    let queryId = initialIdentifier;
    if (!queryId) {
      const urlParams = new URLSearchParams(window.location.search);
      queryId = urlParams.get('token') || urlParams.get('cert') || undefined;

      if (!queryId && window.location.pathname.startsWith('/verify/')) {
        const pathPart = window.location.pathname.replace('/verify/', '').trim();
        if (pathPart) queryId = pathPart;
      }
    }

    if (queryId) {
      setIdentifier(queryId);
      handleVerify(queryId);
    }
  }, [initialIdentifier]);

  const handleVerify = async (queryToUse?: string) => {
    const target = (queryToUse || identifier).trim();
    if (!target) {
      setSearchError('Please enter a certificate number or QR verification token.');
      setResult(null);
      return;
    }

    try {
      setLoading(true);
      setSearchError(null);
      const res = await verifyCertificatePublic(target);
      setResult(res);
    } catch (err: any) {
      setSearchError(err.message || 'Verification service error. Please try again.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setIdentifier('');
    setResult(null);
    setSearchError(null);
  };

  return (
    <div className="public-verify-container">
      {onNavigateHome && (
        <div style={{ marginBottom: '1.25rem' }}>
          <button className="btn btn-outline btn-sm" onClick={onNavigateHome}>
            &larr; Back to Platform Dashboard
          </button>
        </div>
      )}

      {/* Registry Hero Header */}
      <div className="verify-hero">
        <div className="verify-seal">
          <ShieldCheck size={40} color="#10b981" />
        </div>
        <h2>National Skilling Credential Verification Portal</h2>
        <p className="verify-subtitle">
          Official real-time verification registry for state-issued skilling certificates.
          Authenticate digital credentials instantly via unique certificate number or QR code token.
        </p>
      </div>

      {/* Search Box */}
      <div className="verify-search-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleVerify();
          }}
          className="verify-search-form"
        >
          <div className="search-input-wrapper">
            <Search size={18} color="#94a3b8" className="search-icon" />
            <input
              type="text"
              placeholder="Enter Certificate Number (e.g. CERT-2026-XXXXXXXX) or 32-char token..."
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="verify-input"
              disabled={loading}
              autoFocus
            />
            {identifier && (
              <button
                type="button"
                className="btn-clear-search"
                onClick={handleClear}
                disabled={loading}
              >
                &times;
              </button>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-verify"
            disabled={loading}
          >
            {loading ? (
              <>
                <RefreshCw size={16} className="spin-slow" /> Verifying...
              </>
            ) : (
              <>
                Verify Credential <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="verify-hints">
          <span><QrCode size={14} style={{ display: 'inline', marginRight: 4 }} /> Tip: Scanning a certificate QR code opens this page automatically.</span>
        </div>
      </div>

      {searchError && (
        <div className="notice-box error" style={{ maxWidth: '680px', margin: '0 auto 1.5rem' }}>
          <AlertTriangle size={18} />
          <div>{searchError}</div>
        </div>
      )}

      {/* Verification Result Presentation */}
      {result && (
        <div className={`verification-result-card result-${result.status.toLowerCase()}`}>
          {/* Header Banner */}
          <div className="result-header">
            {result.status === 'VALID' && (
              <div className="result-badge-group">
                <CheckCircle2 size={36} color="#10b981" />
                <div>
                  <span className="verify-status-tag valid">VALID CREDENTIAL</span>
                  <div className="verify-status-title">Authentic State-Certified Credential</div>
                </div>
              </div>
            )}

            {result.status === 'CANCELLED' && (
              <div className="result-badge-group">
                <AlertTriangle size={36} color="#f59e0b" />
                <div>
                  <span className="verify-status-tag cancelled">CANCELLED</span>
                  <div className="verify-status-title">Credential Officially Cancelled</div>
                </div>
              </div>
            )}

            {result.status === 'INVALID' && (
              <div className="result-badge-group">
                <XCircle size={36} color="#ef4444" />
                <div>
                  <span className="verify-status-tag invalid">UNVERIFIED / INVALID</span>
                  <div className="verify-status-title">Certificate Not Recognized</div>
                </div>
              </div>
            )}
          </div>

          <div className="result-message-banner">
            {result.message}
          </div>

          {/* Valid Credential Details */}
          {result.status === 'VALID' && (
            <div className="result-details-grid">
              <div className="result-field full-width">
                <span className="field-label">Student Candidate</span>
                <span className="field-value student-name">{result.studentName}</span>
              </div>

              <div className="result-field full-width">
                <span className="field-label">Course / Qualification</span>
                <span className="field-value course-name">{result.courseName}</span>
              </div>

              <div className="result-field">
                <span className="field-label">Certificate Identifier</span>
                <code className="field-code">{result.certificateNumber}</code>
              </div>

              <div className="result-field">
                <span className="field-label">Issue Date</span>
                <span className="field-value">
                  <Calendar size={13} style={{ display: 'inline', marginRight: 4 }} />
                  {result.issueDate ? new Date(result.issueDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>

              <div className="result-field">
                <span className="field-label">Training Centre</span>
                <span className="field-value">
                  <Building2 size={13} style={{ display: 'inline', marginRight: 4 }} />
                  <code>{result.trainingCentreId}</code>
                </span>
              </div>

              <div className="result-field">
                <span className="field-label">District</span>
                <span className="field-value">
                  <MapPin size={13} style={{ display: 'inline', marginRight: 4 }} />
                  <code>{result.districtId}</code>
                </span>
              </div>

              <div className="result-field">
                <span className="field-label">Performance / Grade</span>
                <span className="field-value badge-grade">
                  <Award size={13} style={{ display: 'inline', marginRight: 4 }} />
                  {result.grade || 'Certified'}
                </span>
              </div>

              <div className="result-field">
                <span className="field-label">Registry Integrity</span>
                <span className="field-value" style={{ color: '#10b981', fontWeight: 600 }}>
                  Cryptographically Verified
                </span>
              </div>
            </div>
          )}

          {/* Cancelled Credential Details */}
          {result.status === 'CANCELLED' && (
            <div className="result-details-grid">
              <div className="result-field full-width cancellation-alert-box">
                <span className="field-label" style={{ color: '#f59e0b', fontWeight: 700 }}>
                  Official Cancellation Reason
                </span>
                <div className="cancellation-reason-text">
                  &ldquo;{result.cancellationReason}&rdquo;
                </div>
                {result.cancelledAt && (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                    Cancelled on: {new Date(result.cancelledAt).toLocaleString()} by State Authority
                  </div>
                )}
              </div>

              <div className="result-field">
                <span className="field-label">Certificate Identifier</span>
                <code className="field-code" style={{ color: '#f87171' }}>{result.certificateNumber}</code>
              </div>

              <div className="result-field">
                <span className="field-label">Course</span>
                <span className="field-value">{result.courseName}</span>
              </div>

              <div className="result-field">
                <span className="field-label">Original Issue Date</span>
                <span className="field-value">
                  {result.issueDate ? new Date(result.issueDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>

              <div className="result-field">
                <span className="field-label">Training Centre</span>
                <span className="field-value"><code>{result.trainingCentreId}</code></span>
              </div>
            </div>
          )}

          {/* Invalid Explanation */}
          {result.status === 'INVALID' && (
            <div className="invalid-advice">
              <p>
                The provided certificate number or token could not be verified against the official state registry.
              </p>
              <ul>
                <li>Verify you entered the complete certificate number matching <code>CERT-YYYY-XXXXXXXX</code>.</li>
                <li>If scanning a QR code, ensure the full token URL was loaded.</li>
                <li>Certificates that belong to unapproved or in-review batches cannot be verified.</li>
                <li>Contact the issuing training centre if you believe this is in error.</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Privacy Notice Card */}
      <div className="verify-privacy-card">
        <Lock size={16} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Candidate Privacy Protection:</strong> Under National Data Protection Guidelines, private student contact details (email, phone, national ID) and server file paths are strictly redacted from public verification lookups.
        </div>
      </div>
    </div>
  );
};
