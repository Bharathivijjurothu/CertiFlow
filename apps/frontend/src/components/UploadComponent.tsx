import React, { useState } from 'react';
import { UploadCloud, FileSpreadsheet, Download, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { uploadStudentsFile, getTemplateDownloadUrl } from '../services/api';
import { ValidationReport, Student } from '../types/batch';

interface UploadComponentProps {
  batchId: string;
  onUploadSuccess: (studentsCount: number, preview?: Student[]) => void;
  disabled?: boolean;
}

export const UploadComponent: React.FC<UploadComponentProps> = ({
  batchId,
  onUploadSuccess,
  disabled
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setReport(null);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const result = await uploadStudentsFile(batchId, selectedFile);
      setReport(result.report);

      if (result.success && result.report.valid) {
        setSuccessMessage(`Upload successful! ${result.studentsCount || result.report.summary.totalRows} student records saved atomically.`);
        onUploadSuccess(result.studentsCount || result.report.summary.totalRows, result.preview);
      } else {
        setErrorMessage(result.message || 'Validation failed. 0 student records were saved.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to upload students file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <div className="upload-header">
        <div>
          <h3>Student Data Upload (.xlsx / .csv)</h3>
          <p className="subtitle">
            Strict All-or-Nothing validation: If any row is invalid, zero records will be saved.
          </p>
        </div>
        <div className="template-downloads">
          <span className="template-label">Download Template:</span>
          <a
            href={getTemplateDownloadUrl('csv')}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline btn-sm"
          >
            <Download size={14} /> .CSV
          </a>
          <a
            href={getTemplateDownloadUrl('xlsx')}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline btn-sm"
          >
            <Download size={14} /> .XLSX
          </a>
        </div>
      </div>

      <div className={`dropzone ${selectedFile ? 'has-file' : ''}`}>
        <FileSpreadsheet size={36} color="#60a5fa" />
        <div className="dropzone-text">
          {selectedFile ? (
            <p>
              Selected File: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(1)} KB)
            </p>
          ) : (
            <p>Select a <strong>.xlsx</strong> or <strong>.csv</strong> file matching the official template</p>
          )}
        </div>
        <label className="btn btn-outline file-input-label">
          Choose File
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            disabled={disabled || uploading}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {selectedFile && (
        <div className="upload-actions">
          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={disabled || uploading}
          >
            <UploadCloud size={16} />
            {uploading ? 'Validating & Uploading...' : 'Validate and Upload Students'}
          </button>
        </div>
      )}

      {/* Success Notification */}
      {successMessage && (
        <div className="notice-box success">
          <CheckCircle2 size={20} color="#10b981" />
          <div>{successMessage}</div>
        </div>
      )}

      {/* Error / Validation Report Display */}
      {errorMessage && (
        <div className="notice-box error">
          <AlertOctagon size={20} color="#ef4444" />
          <div>
            <strong>Validation Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      {report && (
        <div className="validation-report-card">
          <div className="report-summary">
            <div className={`summary-badge ${report.valid ? 'valid' : 'invalid'}`}>
              {report.valid ? 'VALIDATION PASSED' : 'STRICT VALIDATION FAILED'}
            </div>
            <div className="summary-metrics">
              <span>Total Rows: <strong>{report.summary.totalRows}</strong></span>
              <span>Valid Rows: <strong style={{ color: '#10b981' }}>{report.summary.validRows}</strong></span>
              <span>Invalid Rows: <strong style={{ color: '#ef4444' }}>{report.summary.invalidRows}</strong></span>
              <span>Errors Found: <strong style={{ color: '#ef4444' }}>{report.summary.errorCount}</strong></span>
            </div>
          </div>

          {!report.valid && report.errors.length > 0 && (
            <div className="validation-errors-table-container">
              <h4>Validation Error Breakdown (All-or-Nothing Rule: 0 records saved)</h4>
              <table className="validation-table">
                <thead>
                  <tr>
                    <th>Row #</th>
                    <th>Field</th>
                    <th>Error Code</th>
                    <th>Error Message</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((err, idx) => (
                    <tr key={idx}>
                      <td><span className="row-tag">Row {err.row}</span></td>
                      <td><strong>{err.field}</strong></td>
                      <td><code>{err.code}</code></td>
                      <td style={{ color: '#fca5a5' }}>{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
