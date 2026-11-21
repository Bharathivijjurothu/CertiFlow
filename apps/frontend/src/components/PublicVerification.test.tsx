import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublicVerification } from './PublicVerification';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  verifyCertificatePublic: vi.fn()
}));

describe('PublicVerification Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders public verification portal and search input without authentication', () => {
    render(<PublicVerification />);

    expect(screen.getByText(/National Skilling Credential Verification Portal/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter Certificate Number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify Credential/i })).toBeInTheDocument();
    expect(screen.getByText(/Candidate Privacy Protection:/i)).toBeInTheDocument();
  });

  it('shows error notice when attempting to submit empty input', async () => {
    render(<PublicVerification />);

    const verifyBtn = screen.getByRole('button', { name: /Verify Credential/i });
    fireEvent.click(verifyBtn);

    expect(screen.getByText(/Please enter a certificate number/i)).toBeInTheDocument();
  });

  it('displays VALID status and candidate details for authentic certificate', async () => {
    vi.mocked(api.verifyCertificatePublic).mockResolvedValueOnce({
      status: 'VALID',
      valid: true,
      message: 'Official Certificate is authentic, verified, and in good standing.',
      certificateNumber: 'CERT-2026-A1B2C3D4',
      studentName: 'Priya Sundaram',
      courseName: 'Solar Photovoltaic Specialist',
      trainingCentreId: 'TC-DELHI-001',
      districtId: 'DIST-NORTH-01',
      issueDate: '2026-03-25T00:00:00.000Z',
      grade: 'Distinction'
    });

    render(<PublicVerification />);

    const input = screen.getByPlaceholderText(/Enter Certificate Number/i);
    fireEvent.change(input, { target: { value: 'CERT-2026-A1B2C3D4' } });

    const verifyBtn = screen.getByRole('button', { name: /Verify Credential/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByText('VALID CREDENTIAL')).toBeInTheDocument();
      expect(screen.getByText('Priya Sundaram')).toBeInTheDocument();
      expect(screen.getByText('Solar Photovoltaic Specialist')).toBeInTheDocument();
      expect(screen.getByText('CERT-2026-A1B2C3D4')).toBeInTheDocument();
      expect(screen.getByText('Distinction')).toBeInTheDocument();
    });
  });

  it('displays CANCELLED status and official reason when certificate is cancelled', async () => {
    vi.mocked(api.verifyCertificatePublic).mockResolvedValueOnce({
      status: 'CANCELLED',
      valid: false,
      message: 'This certificate was officially cancelled and is no longer valid.',
      certificateNumber: 'CERT-2026-99999999',
      courseName: 'Drone Operations',
      trainingCentreId: 'TC-DELHI-001',
      cancellationReason: 'Disciplinary hearing revoking qualification.'
    });

    render(<PublicVerification initialIdentifier="CERT-2026-99999999" />);

    await waitFor(() => {
      expect(screen.getByText('CANCELLED')).toBeInTheDocument();
      expect(screen.getByText(/Disciplinary hearing revoking qualification/i)).toBeInTheDocument();
    });
  });

  it('displays INVALID status when certificate is not found', async () => {
    vi.mocked(api.verifyCertificatePublic).mockResolvedValueOnce({
      status: 'INVALID',
      valid: false,
      message: 'No certificate found matching the provided identifier.'
    });

    render(<PublicVerification initialIdentifier="CERT-2026-NOTFOUND" />);

    await waitFor(() => {
      expect(screen.getByText('UNVERIFIED / INVALID')).toBeInTheDocument();
      expect(screen.getByText(/No certificate found matching the provided identifier/i)).toBeInTheDocument();
    });
  });
});
