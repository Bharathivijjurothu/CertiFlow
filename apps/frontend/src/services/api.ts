import {
  Batch,
  BatchStatus,
  User,
  ValidationReport,
  Student,
  ReviewDecision,
  ReviewProgress,
  BatchReview,
  Certificate,
  BatchDeliveryStatusResponse,
  SimulatedWhatsAppMessage,
  PublicVerificationResult,
  CertificateAuditLog
} from '../types/batch';

export type DemoUser = User;

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  services: {
    api: { status: string };
    database: { status: string; latencyMs: number | null };
    redis: { status: string; latencyMs: number | null };
  };
}

let currentToken: string | null = localStorage.getItem('certiflow_token');

export function setAuthToken(token: string | null) {
  currentToken = token;
  if (token) {
    localStorage.setItem('certiflow_token', token);
  } else {
    localStorage.removeItem('certiflow_token');
  }
}

export function getAuthToken(): string | null {
  return currentToken;
}

function getHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) {
    headers['Content-Type'] = 'application/json';
  }
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  return headers;
}

// Auth API
export async function login(email: string, password = 'CertiFlow@2026'): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Login failed');
  }

  setAuthToken(data.token);
  return data;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok && response.status !== 503) {
    throw new Error(`Health check HTTP error: ${response.status}`);
  }
  return response.json();
}

export async function fetchDemoUsers(): Promise<{ success: boolean; count: number; users: User[] }> {
  const response = await fetch(`${API_BASE_URL}/api/demo-users`);
  if (!response.ok) {
    throw new Error(`Demo users HTTP error: ${response.status}`);
  }
  return response.json();
}

// Batches API
export async function fetchBatches(status?: BatchStatus): Promise<Batch[]> {
  const url = new URL(`${API_BASE_URL}/api/batches`);
  if (status) {
    url.searchParams.append('status', status);
  }

  const res = await fetch(url.toString(), {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch batches');
  }
  return data.batches;
}

export async function fetchBatchDetails(id: string): Promise<Batch> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${id}`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch batch details');
  }
  return data.batch;
}

export interface CreateBatchInput {
  batchNumber: string;
  batchName: string;
  courseName: string;
  districtId: string;
  trainingStartDate: string;
  trainingEndDate: string;
}

export async function createBatch(input: CreateBatchInput): Promise<Batch> {
  const res = await fetch(`${API_BASE_URL}/api/batches`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to create batch');
  }
  return data.batch;
}

export async function updateBatch(
  id: string,
  input: {
    batchName?: string;
    courseName?: string;
    districtId?: string;
    trainingStartDate?: string;
    trainingEndDate?: string;
    expectedVersion: number;
  }
): Promise<Batch> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${id}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(input)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to update batch');
  }
  return data.batch;
}

export async function uploadStudentsFile(
  batchId: string,
  file: File
): Promise<{ success: boolean; message: string; report: ValidationReport; studentsCount?: number; preview?: Student[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentToken}`
    },
    body: formData
  });

  const data = await res.json();
  if (!res.ok && res.status !== 422) {
    throw new Error(data.message || 'Failed to upload students file');
  }
  return data;
}

export async function submitBatch(batchId: string, expectedVersion: number): Promise<Batch> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/submit`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ expectedVersion })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to submit batch');
  }
  return data.batch;
}

export async function transitionBatch(
  batchId: string,
  targetStatus: BatchStatus,
  expectedVersion: number,
  action?: string,
  reason?: string
): Promise<Batch> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/transition`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ targetStatus, expectedVersion, action, reason })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to transition batch status');
  }
  return data.batch;
}

export function getTemplateDownloadUrl(format: 'csv' | 'xlsx'): string {
  return `${API_BASE_URL}/api/batches/template?format=${format}`;
}

// Phase 3: Review Workflow APIs
export async function fetchReviewQueue(): Promise<Batch[]> {
  const res = await fetch(`${API_BASE_URL}/api/batches/review-queue`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch review queue');
  }
  return data.queue;
}

export async function fetchReviewProgress(batchId: string): Promise<ReviewProgress> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/review-progress`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch review progress');
  }
  return data.progress;
}

export async function submitReview(
  batchId: string,
  input: {
    expectedVersion: number;
    decision: ReviewDecision;
    comment?: string;
  }
): Promise<{ batch: Batch; review: BatchReview; nextStatus: BatchStatus }> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/review`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to submit review decision');
  }
  return data;
}

// Phase 4: Certificate Generation APIs
export async function generateCertificates(batchId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/generate-certificates`, {
    method: 'POST',
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to generate certificates');
  }
  return data;
}

export async function fetchBatchCertificates(batchId: string): Promise<Certificate[]> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/certificates`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch certificates');
  }
  return data.certificates;
}

export async function fetchCertificate(certificateId: string): Promise<Certificate> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${certificateId}`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch certificate details');
  }
  return data.certificate;
}

export async function downloadCertificatePdf(certificateId: string, certificateNumber: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${certificateId}/download`, {
    headers: getHeaders(false)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to download certificate PDF');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `certificate-${certificateNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Phase 5: WhatsApp Certificate Delivery APIs
export async function sendBatchCertificates(batchId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/send-certificates`, {
    method: 'POST',
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to queue certificate delivery');
  }
  return data;
}

export async function fetchBatchDeliveryStatus(batchId: string): Promise<BatchDeliveryStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/batches/${batchId}/delivery-status`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch delivery status');
  }
  return data;
}

export async function retryCertificateDelivery(certificateId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${certificateId}/retry-delivery`, {
    method: 'POST',
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to retry certificate delivery');
  }
  return data;
}

export async function fetchSimulatedWhatsAppMessages(): Promise<{ success: boolean; count: number; messages: SimulatedWhatsAppMessage[] }> {
  const res = await fetch(`${API_BASE_URL}/api/whatsapp/simulator/messages`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch simulated WhatsApp messages');
  }
  return data;
}

// Phase 6: Public Verification & Cancellation APIs
export async function verifyCertificatePublic(identifier: string): Promise<PublicVerificationResult> {
  const res = await fetch(`${API_BASE_URL}/api/verify/${encodeURIComponent(identifier.trim())}`);
  const data = await res.json();
  if (!res.ok && res.status !== 404 && res.status !== 400 && res.status !== 429) {
    throw new Error(data.message || 'Verification service error');
  }
  return data;
}

export async function cancelCertificate(certificateId: string, reason: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${certificateId}/cancel`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ reason })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to cancel certificate');
  }
  return data;
}

export async function fetchCertificateAudit(certificateId: string): Promise<{ success: boolean; count: number; auditLogs: CertificateAuditLog[] }> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${certificateId}/audit`, {
    headers: getHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to fetch certificate audit history');
  }
  return data;
}


