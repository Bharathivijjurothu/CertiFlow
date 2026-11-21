export type Role = 'TRAINING_CENTRE' | 'DISTRICT_OFFICER' | 'QUALITY_OFFICER' | 'STATE_OFFICER';

export type BatchStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'DISTRICT_REVIEW'
  | 'QUALITY_REVIEW'
  | 'STATE_REVIEW'
  | 'APPROVED'
  | 'RETURNED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'ISSUED';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  districtId: string | null;
  trainingCentreId: string | null;
  createdAt?: string;
}

export interface Student {
  id: string;
  batchId: string;
  studentId: string | null;
  studentName: string;
  email: string;
  phone: string;
  governmentId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  grade: string | null;
  createdAt: string;
}

export interface BatchHistory {
  id: string;
  batchId: string;
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  fromStatus: BatchStatus;
  toStatus: BatchStatus;
  action: string;
  reason: string | null;
  createdAt: string;
}

export interface BatchReview {
  id: string;
  batchId: string;
  reviewerId: string;
  reviewerRole: Role;
  reviewer?: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  round: number;
  stage: ReviewStage;
  decision: ReviewDecision;
  comment: string | null;
  createdAt: string;
}

export type ReviewDecision = 'APPROVED' | 'RETURNED' | 'REJECTED';
export type ReviewStage = 'DISTRICT' | 'QUALITY' | 'STATE';

export interface ReviewProgress {
  currentRound: number;
  currentStatus: BatchStatus;
  studentCount: number;
  district: {
    required: number;
    approvedCount: number;
    isComplete: boolean;
    approvals: Array<{
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    }>;
    alreadyApprovedByCurrentUser: boolean;
    canCurrentUserApprove: boolean;
  };
  quality: {
    required: boolean;
    threshold: number;
    isComplete: boolean;
    approval: {
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    } | null;
  };
  state: {
    isComplete: boolean;
    approval: {
      reviewerId: string;
      reviewerName: string;
      createdAt: string;
    } | null;
  };
  allReviews: BatchReview[];
}

export type CertificateStatus = 'GENERATED' | 'CANCELLED' | 'REVOKED';

export interface Certificate {
  id: string;
  certificateNumber: string;
  studentId: string;
  student?: Student;
  batchId: string;
  courseName: string;
  trainingCentreId: string;
  districtId: string;
  issueDate: string;
  status: CertificateStatus;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  cancelledById?: string | null;
  pdfPath: string;
  verificationToken: string;
  qrCodeUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  batchNumber: string;
  batchName: string;
  courseName: string;
  trainingCentreId: string;
  districtId: string;
  trainingStartDate: string;
  trainingEndDate: string;
  status: BatchStatus;
  version: number;
  approvalRound: number;
  createdById: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  studentCount?: number;
  students?: Student[];
  history?: BatchHistory[];
  reviews?: BatchReview[];
  certificates?: Certificate[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationErrorItem {
  row: number;
  field: string;
  code: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errorCount: number;
  };
  errors: ValidationErrorItem[];
}

// Phase 5: WhatsApp Certificate Delivery Types
export type DeliveryStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface CertificateDelivery {
  id: string;
  certificateId: string;
  certificateNumber: string;
  studentId: string;
  studentName: string;
  maskedPhone: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  simulatedMessageId: string | null;
}

export interface BatchDeliveryStatusResponse {
  batchId: string;
  totalEligible: number;
  stats: {
    queued: number;
    processing: number;
    sent: number;
    failed: number;
    notQueued: number;
  };
  deliveries: CertificateDelivery[];
}

export interface SimulatedWhatsAppMessage {
  messageId: string;
  recipientPhone: string;
  maskedPhone: string;
  studentName: string;
  courseName: string;
  certificateNumber: string;
  body: string;
  status: 'DELIVERED' | 'FAILED';
  error?: string;
  timestamp: string;
}

// Phase 6: Public Verification & Cancellation Types
export type PublicVerificationStatus = 'VALID' | 'CANCELLED' | 'INVALID';

export interface PublicVerificationResult {
  status: PublicVerificationStatus;
  valid: boolean;
  message: string;
  certificateNumber?: string;
  studentName?: string;
  courseName?: string;
  trainingCentreId?: string;
  districtId?: string;
  issueDate?: string;
  grade?: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
}

export interface CertificateAuditLog {
  id: string;
  certificateId: string;
  action: string;
  performedById: string | null;
  performedBy?: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  reason: string | null;
  metadata: string | null;
  createdAt: string;
}


