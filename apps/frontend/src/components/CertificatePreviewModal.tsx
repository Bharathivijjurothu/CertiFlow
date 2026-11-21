import React, { useState } from 'react';
import { X, Download, ShieldCheck, QrCode, ExternalLink } from 'lucide-react';
import { Certificate } from '../types/batch';
import { downloadCertificatePdf } from '../services/api';

interface CertificatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificate: Certificate | null;
}

export const CertificatePreviewModal: React.FC<CertificatePreviewModalProps> = ({
  isOpen,
  onClose,
  certificate
}) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (!isOpen || !certificate) return null;

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadError(null);
      await downloadCertificatePdf(certificate.id, certificate.certificateNumber);
    } catch (err: any) {
      setDownloadError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const studentName = certificate.student?.studentName || 'Certified Candidate';

  return (
    <div className="modal-overlay">
      <div className="modal-container cert-preview-modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldCheck size={22} color="#10b981" />
            <h2>Official Certificate Preview</h2>
          </div>
          <button className="close-btn" onClick={onClose} disabled={downloading}>
            <X size={20} />
          </button>
        </div>

        {downloadError && (
          <div className="notice-box error">{downloadError}</div>
        )}

        <div className="cert-preview-card">
          <div className="cert-preview-inner">
            <div className="cert-preview-top">
              <span className="cert-preview-registry">CERTIFLOW VERIFIED CREDENTIAL</span>
              <span className="cert-status-pill">{certificate.status}</span>
            </div>

            <div className="cert-preview-title">
              CERTIFICATE OF ACHIEVEMENT
            </div>

            <div className="cert-preview-subtitle">
              This is to certify that
            </div>

            <div className="cert-preview-name">
              {studentName}
            </div>

            <div className="cert-preview-text">
              has successfully completed all requirements for
            </div>

            <div className="cert-preview-course">
              {certificate.courseName}
            </div>

            <div className="cert-preview-grid">
              <div className="cert-grid-cell">
                <span className="label">Certificate ID:</span>
                <code>{certificate.certificateNumber}</code>
              </div>
              <div className="cert-grid-cell">
                <span className="label">Issue Date:</span>
                <span>{new Date(certificate.issueDate).toLocaleDateString()}</span>
              </div>
              <div className="cert-grid-cell">
                <span className="label">Centre & District:</span>
                <span>{certificate.trainingCentreId} • {certificate.districtId}</span>
              </div>
              <div className="cert-grid-cell">
                <span className="label">Security Token:</span>
                <code style={{ fontSize: '0.75rem' }}>{certificate.verificationToken.slice(0, 16)}...</code>
              </div>
            </div>

            <div className="cert-preview-qr-row">
              <div className="cert-qr-info">
                <QrCode size={18} color="#60a5fa" />
                <span>Instant QR Verification Active</span>
              </div>
              <span className="cert-qr-url">
                <ExternalLink size={12} style={{ display: 'inline', marginRight: 4 }} />
                {certificate.qrCodeUrl}
              </span>
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={downloading}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={handleDownload}
            disabled={downloading}
          >
            <Download size={16} />
            {downloading ? 'Downloading...' : 'Download Official PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};
