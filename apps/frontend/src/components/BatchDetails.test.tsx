import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchDetails } from './BatchDetails';
import { Batch, User } from '../types/batch';

const mockTCUser: User = {
  id: 'user-anika',
  name: 'Anika',
  email: 'anika@certiflow.local',
  role: 'TRAINING_CENTRE',
  districtId: null,
  trainingCentreId: 'TC-DELHI-001'
};

const mockBatchEmpty: Batch = {
  id: 'batch-1',
  batchNumber: 'BATCH-2026-001',
  batchName: 'Solar Technician 2026',
  courseName: 'Solar PV Installation',
  trainingCentreId: 'TC-DELHI-001',
  districtId: 'DIST-NORTH-01',
  trainingStartDate: '2026-01-01',
  trainingEndDate: '2026-03-01',
  status: 'DRAFT',
  version: 1,
  createdById: 'user-anika',
  createdBy: { id: 'user-anika', name: 'Anika', email: 'anika@certiflow.local', role: 'TRAINING_CENTRE' },
  studentCount: 0,
  students: [],
  history: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const mockBatchWithStudents: Batch = {
  ...mockBatchEmpty,
  studentCount: 3,
  students: [
    {
      id: 'stu-1',
      batchId: 'batch-1',
      studentId: 'GOV-101',
      studentName: 'Aarav Sharma',
      email: 'aarav@example.com',
      phone: '9876543210',
      governmentId: 'GOV-101',
      dateOfBirth: null,
      gender: 'Male',
      grade: 'A',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]
};

describe('BatchDetails - Submission Control & Concurrency Guard', () => {
  it('disables or hides submit action when student count is 0', () => {
    render(
      <BatchDetails
        batch={mockBatchEmpty}
        currentUser={mockTCUser}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.queryByText('Submit Batch')).not.toBeInTheDocument();
    expect(screen.getByText('Edit Batch')).toBeInTheDocument();
    expect(screen.getByText(/Optimistic Lock: Version 1/i)).toBeInTheDocument();
  });

  it('enables submit action when valid students exist in DRAFT batch', () => {
    render(
      <BatchDetails
        batch={mockBatchWithStudents}
        currentUser={mockTCUser}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Submit Batch')).toBeInTheDocument();
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument();
    expect(screen.getByText('aarav@example.com')).toBeInTheDocument();
  });

  it('shows Return to Centre button for District Officer on review', () => {
    const mockDOUser: User = {
      id: 'user-dev',
      name: 'Dev',
      email: 'dev@certiflow.local',
      role: 'DISTRICT_OFFICER',
      districtId: 'DIST-NORTH-01',
      trainingCentreId: null
    };

    const mockReviewBatch: Batch = {
      ...mockBatchWithStudents,
      status: 'DISTRICT_REVIEW',
      version: 3
    };

    render(
      <BatchDetails
        batch={mockReviewBatch}
        currentUser={mockDOUser}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Approve (District)')).toBeInTheDocument();
    expect(screen.getByText('Return')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });
});
