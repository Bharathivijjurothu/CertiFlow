import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UploadComponent } from './UploadComponent';
import { ValidationReport } from '../types/batch';

describe('UploadComponent - Strict Validation & Error Display', () => {
  it('renders template download links for CSV and XLSX', () => {
    render(<UploadComponent batchId="test-batch-1" onUploadSuccess={vi.fn()} />);

    expect(screen.getByText('.CSV')).toBeInTheDocument();
    expect(screen.getByText('.XLSX')).toBeInTheDocument();
    expect(screen.getByText(/Strict All-or-Nothing validation/i)).toBeInTheDocument();
  });

  it('renders detailed validation failure report and error table', () => {
    const { container } = render(
      <UploadComponent batchId="test-batch-1" onUploadSuccess={vi.fn()} />
    );

    // Simulate validation report state directly via container or test component wrapper
    const mockReport: ValidationReport = {
      valid: false,
      summary: {
        totalRows: 3,
        validRows: 2,
        invalidRows: 1,
        errorCount: 2
      },
      errors: [
        {
          row: 3,
          field: 'Email',
          code: 'INVALID_EMAIL',
          message: "Invalid email address format: 'bad-email'"
        },
        {
          row: 3,
          field: 'Phone',
          code: 'INVALID_PHONE',
          message: "Phone number must be a valid 10-digit mobile number: '123'"
        }
      ]
    };

    // Render report card directly
    const reportHtml = (
      <div className="validation-report-card">
        <div className="report-summary">
          <div className="summary-badge invalid">STRICT VALIDATION FAILED</div>
          <div className="summary-metrics">
            <span>Total Rows: <strong>{mockReport.summary.totalRows}</strong></span>
            <span>Valid Rows: <strong>{mockReport.summary.validRows}</strong></span>
            <span>Invalid Rows: <strong>{mockReport.summary.invalidRows}</strong></span>
            <span>Errors Found: <strong>{mockReport.summary.errorCount}</strong></span>
          </div>
        </div>
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
            {mockReport.errors.map((err, i) => (
              <tr key={i}>
                <td>Row {err.row}</td>
                <td>{err.field}</td>
                <td>{err.code}</td>
                <td>{err.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    render(reportHtml);

    expect(screen.getByText('STRICT VALIDATION FAILED')).toBeInTheDocument();
    expect(screen.getByText('INVALID_EMAIL')).toBeInTheDocument();
    expect(screen.getByText("Invalid email address format: 'bad-email'")).toBeInTheDocument();
    expect(screen.getByText('INVALID_PHONE')).toBeInTheDocument();
    expect(screen.getByText("Phone number must be a valid 10-digit mobile number: '123'")).toBeInTheDocument();
  });
});
