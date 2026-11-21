# CertiFlow - Skilling Certificate Issuance Platform

CertiFlow is a secure, verifiable skilling certificate issuance platform designed for state and district level governance.

This repository implements the complete end-to-end platform across **Phases 1 through 7**:
- **Phase 1**: Project Scaffolding & Local Docker Compose Setup (Postgres, Redis, API, Frontend)
- **Phase 2**: Batch Management, Excel/CSV Upload, Strict Validation, Batch State Machine, and Concurrency Safety
- **Phase 3**: Multi-Role Review & Approval Workflow (District $\rightarrow$ Quality $\rightarrow$ State)
- **Phase 4**: Certificate Number Generation, Professional PDF Creation, QR Codes & Secure File Storage
- **Phase 5**: WhatsApp Certificate Delivery, Queue Processing, Simulator, and Status Tracking
- **Phase 6**: Public Certificate Verification, Status Evaluation (`VALID`, `CANCELLED`, `INVALID`), and State Officer Cancellation
- **Phase 7**: Comprehensive Testing, Security Review, Project Completion & Hackathon Demo Workflow

---

## 1. Project Structure

```
certiflow/
├── .env                             # Active environment configuration
├── .env.example                     # Environment variables template
├── .gitignore                       # Git ignore specifications
├── README.md                        # Documentation and run instructions
├── docker-compose.yml               # Multi-container local orchestration (Postgres, Redis, API, Frontend)
├── package.json                     # Root monorepo workspace configuration
│
├── apps/
│   ├── backend/                     # Node.js + Express + TypeScript + Prisma API
│   │   ├── Dockerfile               # Multi-stage production container
│   │   ├── .dockerignore
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Database schema (User, Batch, Student, BatchHistory)
│   │   │   ├── seed.ts              # Idempotent demo account seed script (bcrypt)
│   │   │   └── migrations/          # Versioned SQL migrations (Phase 1 & Phase 2)
│   │   ├── src/
│   │   │   ├── index.ts             # Express application entrypoint
│   │   │   ├── config/              # Environment, DB, Redis
│   │   │   ├── middleware/          # JWT authentication and role authorization
│   │   │   ├── routes/
│   │   │   │   ├── auth.route.ts    # POST /api/auth/login, GET /api/auth/me
│   │   │   │   ├── batches.route.ts # Full batch lifecycle & review endpoints
│   │   │   │   ├── health.route.ts  # GET /health
│   │   │   │   └── users.route.ts   # GET /api/demo-users
│   │   │   └── services/
│   │   │       ├── auth.service.ts              # Password verification & JWT issuance
│   │   │       ├── stateMachine.service.ts      # Batch State Machine & Optimistic Locking
│   │   │       └── uploadValidation.service.ts  # Strict Atomic Excel/CSV parser
│   │   └── tests/
│   │       └── phase2.test.ts       # Automated backend test suite (13 test scenarios)
│   │
│   └── frontend/                    # React 18 + Vite + TypeScript Status & Batch Dashboard
│       ├── Dockerfile               # Container running Vite development server
│       ├── .dockerignore
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx              # Role simulator, Batches UI & System Health
│           ├── types/batch.ts       # Shared TypeScript domain models
│           ├── services/api.ts      # Typed REST client with JWT interceptor
│           └── components/
│               ├── UserSwitcher.tsx # Instant 1-click role switcher
│               ├── BatchList.tsx    # Filtered batches table with status tabs
│               ├── BatchDetails.tsx # Detailed view, actions toolbar, student roster
│               ├── CreateBatchModal.tsx # New batch modal form
│               ├── UploadComponent.tsx  # Drag & drop Excel/CSV upload with validation breakdown
│               ├── ReviewModal.tsx      # Return / Reject reason prompt
│               ├── StatusCard.tsx   # Service health widget
│               └── DemoUsers.tsx    # Provisioned accounts overview
```

---

## 2. Technologies Used

- **Frontend**: React 18, Vite 6, TypeScript, Lucide Icons, Fetch API
- **Backend**: Node.js 20, Express, TypeScript, Prisma ORM 5, jsonwebtoken, bcryptjs, multer, xlsx (SheetJS), ioredis
- **Database & Cache**: PostgreSQL 16 (Alpine), Redis 7 (Alpine)
- **Infrastructure**: Docker, Docker Compose, Docker Health Checks, Named Volumes

---

## 3. Demo Login Credentials & Roles

All demo accounts are seeded with encrypted passwords (`bcrypt`, 10 rounds). Default demo password: `CertiFlow@2026`.

| Name | Role | Email | Scope / Assignment | Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Anika** | `TRAINING_CENTRE` | `anika@certiflow.local` | Centre `TC-DELHI-001` | Create batch, upload student roster, submit batch, resubmit returned batches |
| **Dev** | `DISTRICT_OFFICER` | `dev@certiflow.local` | District `DIST-NORTH-01` | District review approval 1 of 2, return/reject batches |
| **Kabir** | `DISTRICT_OFFICER` | `kabir@certiflow.local` | District `DIST-NORTH-01` | District review approval 2 of 2 (distinct DO in North District), return/reject |
| **Meera** | `DISTRICT_OFFICER` | `meera@certiflow.local` | District `DIST-SOUTH-02` | District review oversight for South Delhi (demonstrating cross-district block) |
| **Neha** | `QUALITY_OFFICER` | `neha@certiflow.local` | State-wide QA | Quality audits for batches $\ge$ 50 students, return/reject |
| **Farah** | `STATE_OFFICER` | `farah@certiflow.local` | Apex State Authority | Final approval verification, advance to APPROVED |

---

## 4. Batch Lifecycle & State Machine

CertiFlow implements a central backend state machine that strictly governs all batch transitions:

```
[DRAFT] ──────> [SUBMITTED] ──────> [DISTRICT_REVIEW] ──┬──> [QUALITY_REVIEW] ──┬──> [STATE_REVIEW] ──> [APPROVED] ──> [PROCESSING] ──> [ISSUED]
   ▲                 ▲                     │            │            │          │           │
   │                 │                     ├──> [RETURNED]           ├──> [RETURNED]        ├──> [RETURNED]
   │                 └─────────────────────┤                         │                      │
   │                                       └──> [REJECTED]           └──> [REJECTED]        └──> [REJECTED]
   └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Allowed Transitions:
1. `DRAFT -> SUBMITTED` (Training Centre only; requires $\ge 1$ students)
2. `SUBMITTED -> DISTRICT_REVIEW` (District Officer in matching district)
3. `DISTRICT_REVIEW -> QUALITY_REVIEW` (District Officer; batches $\ge$ configurable threshold of 50 students)
4. `DISTRICT_REVIEW -> STATE_REVIEW` (District Officer; standard batches)
5. `DISTRICT_REVIEW -> RETURNED` (District Officer; requires correction reason)
6. `DISTRICT_REVIEW -> REJECTED` (District Officer; requires rejection reason)
7. `QUALITY_REVIEW -> STATE_REVIEW` (Quality Officer)
8. `QUALITY_REVIEW -> RETURNED` (Quality Officer)
9. `QUALITY_REVIEW -> REJECTED` (Quality Officer)
10. `STATE_REVIEW -> APPROVED` (State Officer; final review authorization)
11. `STATE_REVIEW -> RETURNED` (State Officer)
12. `STATE_REVIEW -> REJECTED` (State Officer)
13. `RETURNED -> SUBMITTED` (Training Centre after correcting data; restarts fresh approval round)
14. `APPROVED -> PROCESSING` (State Officer or automated processing)
15. `PROCESSING -> ISSUED` (State Officer or issuance engine)

*All other transitions are rejected with HTTP 400 `INVALID_STATUS_TRANSITION`.*

---

## 5. Excel / CSV Student Upload & Strict Atomic Validation

### Upload Template Specification:
Sample templates can be downloaded directly via:
- **CSV Template**: `GET /api/batches/template?format=csv`
- **XLSX Template**: `GET /api/batches/template?format=xlsx`

### Required & Optional Columns:

| Column Name | Required? | Validation Rules | Error Code |
| :--- | :--- | :--- | :--- |
| **Student Name** | **Yes** | String, min 2 characters | `MISSING_STUDENT_NAME` |
| **Email** | **Yes** | Valid RFC 5322 email regex (`^[^@]+@[^@]+\.[^@]+$`) | `INVALID_EMAIL` |
| **Phone** | **Yes** | 10-digit Indian mobile number (`^[6-9]\d{9}$`) | `INVALID_PHONE` |
| **Government ID** | Optional | Unique ID or alphanumeric string | &mdash; |
| **Date of Birth** | Optional | YYYY-MM-DD or DD/MM/YYYY | &mdash; |
| **Gender** | Optional | Male / Female / Other | &mdash; |
| **Grade** | Optional | Grade or score (e.g. A, B+, Pass) | &mdash; |

### Configurable Limits:
- **File Types**: `.xlsx`, `.xls`, `.csv` (verified by extension and MIME format)
- **Max File Size**: 5 MB (`MAX_UPLOAD_SIZE_BYTES=5242880`)
- **Max Rows**: 1,000 rows (`MAX_UPLOAD_ROWS=1000`)
- **Quality Review Threshold**: 50 students (`QUALITY_REVIEW_THRESHOLD=50`)

### Strict All-or-Nothing Rule:
- The backend parses the file into memory and runs validation on all headers and rows.
- Checks for in-file duplicate emails (`DUPLICATE_EMAIL_IN_FILE`) and phones (`DUPLICATE_PHONE_IN_FILE`).
- **If even 1 row is invalid**: the API returns HTTP 422 with a structured error breakdown identifying the exact Excel row number, field name, error code, and error message. **Zero student records are saved into the database.**
- **If all rows are valid**: all records are inserted inside an atomic database transaction (`prisma.$transaction`), the batch version is incremented, and a history record is logged.

---

## 6. Concurrency Safety & Optimistic Locking

To guarantee database integrity under concurrent access:
1. Every batch has an integer `version` field starting at `1`.
2. State transitions and metadata edits require `expectedVersion`.
3. Updates execute an atomic conditional query:
   ```sql
   UPDATE "Batch"
   SET status = :targetStatus, version = version + 1
   WHERE id = :batchId AND status = :currentStatus AND version = :expectedVersion;
   ```
4. If two users attempt conflicting transitions simultaneously, exactly one succeeds; the competing request finds 0 affected rows and immediately returns **HTTP 409 Conflict** (`CONCURRENCY_CONFLICT`).
5. Double-clicks or repeated submissions with stale versions are blocked safely.

---

## 7. API Reference

All `/api/batches` routes require a Bearer JWT token in the `Authorization` header.

| Method | Endpoint | Authorized Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | Login with email and password, receives JWT token |
| `GET` | `/api/auth/me` | Authenticated | Get current authenticated user profile |
| `GET` | `/api/batches/template` | Authenticated | Download student upload template (`?format=csv` or `?format=xlsx`) |
| `POST` | `/api/batches` | `TRAINING_CENTRE` | Create a new training batch in `DRAFT` status |
| `GET` | `/api/batches` | All Roles | List batches scoped to user's centre / district / state |
| `GET` | `/api/batches/:id` | All Roles | Get batch details, student roster, and full transition history |
| `PUT` | `/api/batches/:id` | `TRAINING_CENTRE` | Edit metadata for `DRAFT` or `RETURNED` batches (with version check) |
| `POST` | `/api/batches/:id/upload` | `TRAINING_CENTRE` | Upload student data with atomic validation |
| `POST` | `/api/batches/:id/submit` | `TRAINING_CENTRE` | Submit batch (`DRAFT`/`RETURNED` $\to$ `SUBMITTED`, increments `approvalRound` on resubmission) |
| `GET` | `/api/batches/review-queue` | Officers | Queue of batches awaiting review by current officer |
| `GET` | `/api/batches/:id/review-progress` | Authenticated | Detailed multi-stage review progress (District 1/2, Quality, State) |
| `POST` | `/api/batches/:id/review` | Officers | Submit review decision (`APPROVED`, `RETURNED`, `REJECTED`) with version check |
| `POST` | `/api/batches/:id/transition` | Officers | Legacy batch status transitions |
| `GET` | `/health` | Public | Live health check for API, PostgreSQL, and Redis |

---

## 6. Phase 3: Multi-Role Batch Review & Approval Workflow

CertiFlow implements a multi-role review and verification pipeline before any batch reaches final approval:

```
[Training Centre Submit]
          │
          ▼
 [District Review] ────────► Requires 2 Distinct District Officers in the assigned district
          │                  (Duplicate officer approvals & creator self-approvals blocked)
          │
          ├── Student Count < QUALITY_REVIEW_THRESHOLD (50): Skips Quality Review
          │   │
          │   ▼
          └── Student Count >= 50 ──► [Quality Review] ──► Quality Officer Approval
                                                              │
                                                              ▼
                                                       [State Review] ──► State Officer Final Approval
                                                              │
                                                              ▼
                                                          [APPROVED]
```

### Review Rules & Guarantees:
1. **Two Distinct District Officers**: A batch cannot advance past District Review without approval from two different officers assigned to the batch's district. The same officer cannot approve twice.
2. **Conflict of Interest Protection**: A user who created a batch cannot approve their own batch.
3. **Configurable Quality Review Threshold**: Evaluated using the batch's actual student count against `QUALITY_REVIEW_THRESHOLD` (default: 50). Batches $\ge$ 50 must be approved by a `QUALITY_OFFICER`. Batches with $< 50$ students skip Quality Review and advance directly to `STATE_REVIEW`.
4. **State Officer Final Approval**: Only the `STATE_OFFICER` can grant final approval to transition the batch to `APPROVED`. All prerequisite District and Quality requirements are re-verified prior to approval.
5. **Return for Correction**: Returning a batch requires a non-empty reason. When returned, the batch status becomes `RETURNED` and is editable by the Training Centre. Resubmission increments `approvalRound` ($1 \to 2$) and initiates a fresh approval round. Previous round approvals are preserved in history for audit compliance but do not satisfy the new round.
6. **Rejection**: Rejecting a batch requires a non-empty reason and is final (`REJECTED`).
7. **Concurrency & Optimistic Locking**: Every review requires `expectedVersion`. Conflicting updates are rejected with HTTP 409 Conflict. Database constraint `@@unique([batchId, round, stage, reviewerId])` prevents duplicate reviews.

---

## 7. Phase 4: Certificate Generation, PDF Creation, QR Codes & Secure Storage

CertiFlow implements an official certificate issuance engine that generates cryptographically verifiable PDF credentials with embedded QR codes.

### 1. Certificate Eligibility
- Only batches in **`APPROVED`** (or **`PROCESSING`** for retries) status can generate certificates.
- Only the **`STATE_OFFICER`** role can trigger certificate generation.
- Batches in `DRAFT`, `SUBMITTED`, `DISTRICT_REVIEW`, `QUALITY_REVIEW`, or `RETURNED` cannot generate certificates (rejected with HTTP 400 `BATCH_NOT_APPROVED`).

### 2. Certificate Number Format
- Format: **`CERT-YYYY-XXXXXXXX`** (e.g., `CERT-2026-F9A1B2C3`)
  - `YYYY`: 4-digit completion/issue year
  - `XXXXXXXX`: 8-character uppercase alphanumeric code from a cryptographically secure random generator
- Guaranteed uniqueness via PostgreSQL database constraint: `@@unique([certificateNumber])`.
- Composite unique constraint: `@@unique([batchId, studentId])` guarantees one certificate per candidate per batch.

### 3. QR Code & Verification URL
- Generated using `qrcode` library as a PNG image buffer and embedded directly into the certificate PDF.
- URL Format: **`${VERIFICATION_BASE_URL}/verify/${verificationToken}`**
- `verificationToken`: 32-character secure random token (`crypto.randomBytes(16).toString('hex')`).
- No sensitive student PII (email, phone, etc.) is exposed directly in the QR code.

### 4. Professional PDF Template (`pdfkit`)
- Rendered in standard **A4 Landscape** (842 x 595 pt).
- **Styling**:
  - Double border: Navy outer border (`#0f172a`) and inner gold accent border (`#d97706`) with corner ornaments.
  - Header: CertiFlow National Skilling & Certification Registry branding.
  - Title: "CERTIFICATE OF SKILLING & ACHIEVEMENT".
  - Student Name: Bold, uppercase, with dynamic font-scaling to prevent overflowing long candidate names.
  - Course Name: Bold emerald green (`#047857`).
  - Metadata Box: Training Centre ID, District, Training Period, and Grade.
  - Left Footer: High-resolution embedded QR code with "Scan to Verify Authenticity".
  - Center Footer: Official Certificate Identifier and issue date.
  - Right Footer: Digital authority signature lines for State Officer and Quality Authority.

### 5. Storage Approach
- PDFs are stored on a persistent volume mount (`certiflow_certificate_storage` at `/app/storage/certificates`).
- PostgreSQL stores only metadata, unique certificate numbers, security tokens, and file references (`pdfPath`), preventing database bloat.

### 6. Background Processing & Idempotency
- Managed via **BullMQ / Redis** queue (`certificate-generation`) with exponential backoff retries.
- **Idempotency Guarantee**: If a job is retried or interrupted, existing certificates for `(batchId, studentId)` are identified and skipped. Zero duplicate records or duplicate files are created.
- **Lifecycle Transition**: Batch status moves to `PROCESSING` when generation starts, and transitions to `ISSUED` once all student certificates are successfully generated. Partial failures leave the batch in `PROCESSING` with failed candidates explicitly reported.

---

## 8. Phase 5: WhatsApp Certificate Delivery

Phase 5 implements automated certificate dispatch via a WhatsApp simulator, background queues, exponential backoff retries, and privacy-first delivery tracking.

### 1. Delivery Architecture & Background Jobs
- **BullMQ & Redis Queue**: Asynchronous processing queue (`whatsapp-delivery`) with dedicated worker.
- **Job Payload**: Contains strictly scoped identifiers (`certificateId`, `studentId`, `batchId`). PII is never stored in raw job payloads or queue messages.
- **Eligibility Verification**:
  - Batch must be in `ISSUED` status with generated certificates.
  - Certificate PDF must exist and be accessible.
  - Student must have a valid recipient phone number.
  - Certificate must not already have a `SENT` delivery record (Idempotency guarantee).

### 2. WhatsApp Simulator (Hackathon Environment)
- **Zero External Telecommunication Costs**: Never makes real network requests or requires WhatsApp Business API credentials.
- **Realistic Dispatch Format**:
  - Constructs official message with candidate name, course, certificate number, and secure credential access link (`http://localhost:5173/verify?token=...`).
  - Records outbound simulated messages into an in-memory audit ledger with unique identifiers (`WAMID.SIMULATED.<timestamp>.<hash>`).
- **Deterministic Testing**:
  - Numbers ending in `9999` or requests with `failSimulated: true` deterministically trigger simulated carrier timeouts (`GATEWAY_TIMEOUT`).
  - Phone numbers with fewer than 10 digits trigger immediate permanent errors (`INVALID_PHONE_NUMBER`).

### 3. Delivery Status Model & Database Tracking
Tracks each delivery lifecycle in PostgreSQL (`CertificateDelivery` and `DeliveryAttemptLog`):
- `PENDING`: Certificate issued, delivery awaiting queue dispatch.
- `QUEUED`: Enqueued in BullMQ worker.
- `PROCESSING`: Worker is communicating with WhatsApp simulator.
- `SENT`: Successfully acknowledged by WhatsApp simulator with timestamp and message ID.
- `FAILED`: Delivery failed permanently (invalid phone) or exhausted all retry attempts (max 3).

### 4. Retry Policies & Error Handling
- **Transient Failures**: Carrier timeouts or simulated network drops are retried up to 3 times with exponential backoff.
- **Permanent Errors**: Invalid phone formats (< 10 digits) fail immediately without consuming retry quotas (`isPermanent: true`).
- **Manual Retry API**: Authorized users can trigger a manual retry for `FAILED` deliveries via `POST /api/certificates/:id/retry-delivery`.

### 5. Privacy & PII Protection
- All recipient phone numbers are masked on backend retrieval and in UI presentations (e.g., `9876543210` $\rightarrow$ `98****3210`).
- Strict role authorization: Training Centre users can only dispatch to their own centre's candidates; District Officers can only dispatch to batches within their district.

### 6. Delivery Tracking UI & Simulator Ledger
- **Live Metrics Cards**: Total Eligible, Delivered (`SENT`), Queued/In Progress (`QUEUED`/`PROCESSING`), and Failed (`FAILED`).
- **Delivery Column**: Integrated into the Certificates table showing masked phone, status pill, attempt counts, and 1-click retry.
- **Dedicated WhatsApp Tab**: Includes real-time message bubble stream showing simulated delivery timestamps and exact message text.

---

## 9. Phase 6: Public Certificate Verification & Cancellation

CertiFlow includes a high-integrity, public-facing certificate verification portal operating without authentication.

### 1. Dual Lookup Mechanisms
- **Manual Lookup**: Users can enter the canonical certificate number (e.g. `CERT-2026-A1B2C3D4`). Matching is case-insensitive.
- **QR Code Scanning**: QR codes encode `http://localhost:5173/verify/<32-char-token>`. Scanning a certificate automatically opens the verification portal and authenticates the token in real-time.

### 2. Status Evaluation
- **`VALID` (Emerald Green)**: Authentic, active certificate belonging to an approved and issued batch. Displays candidate name, qualification, issuing centre, district, issue date, and performance grade.
- **`CANCELLED` (Amber / Red)**: Officially revoked certificate. Clearly displays the official reason for cancellation, timestamp of cancellation, and issuing authority details.
- **`INVALID` (Red)**: Nonexistent certificate, unrecognized token, malformed format, or certificates associated with unapproved / unissued batches.

### 3. Security, Rate Limiting & Privacy Controls
- **Public Rate Limiter**: 60 requests per minute per IP address (`X-RateLimit-Limit`, `X-RateLimit-Remaining`). Excess requests receive HTTP 429 (`RATE_LIMIT_EXCEEDED`).
- **Data Minimization (PII Stripping)**: Candidate personal contact details (phone, email, government ID, date of birth) and internal database UUIDs/file storage paths are strictly stripped from all public responses.
- **Unapproved Batch Protection**: Certificates from batches in `DRAFT`, `SUBMITTED`, `DISTRICT_REVIEW`, `QUALITY_REVIEW`, `STATE_REVIEW`, `RETURNED`, or `PROCESSING` are rejected as `INVALID`.

### 4. State Officer Certificate Cancellation
- Authorized **State Officers** can cancel an issued certificate via `POST /api/certificates/:id/cancel`.
- Requires a mandatory descriptive cancellation reason ($\ge 5$ characters).
- Changes certificate status to `CANCELLED` and immutably records both a `CertificateAuditLog` and a `BatchHistory` audit event.
- Prevents double-cancellation (HTTP 400 `ALREADY_CANCELLED`).

---

## 10. How to Start the Project & Run All Tests

### Start the Application with Docker Compose:
```bash
docker compose up --build -d
```

Access the application:
- **Frontend Dashboard & Public Verification**: [http://localhost:5173](http://localhost:5173)
- **Direct Public Verification**: [http://localhost:5173/verify](http://localhost:5173/verify)
- **Backend API**: [http://localhost:5000](http://localhost:5000)
- **Public Verification API**: [http://localhost:5000/api/verify/:identifier](http://localhost:5000/api/verify/:identifier)
- **System Health Diagnostics**: [http://localhost:5000/health](http://localhost:5000/health)

---

### Run the Automated Test Suites:

**1. Frontend Component Test Suite (10 Tests Passing):**
```bash
npm test --prefix apps/frontend
```

**2. Phase 2 Backend Integration Test Suite (13 Scenarios Passing):**
```bash
docker exec certiflow-backend npm run test:phase2
```

**3. Phase 3 Review & Approval Workflow Test Suite (16 Scenarios Passing):**
```bash
docker exec certiflow-backend npm run test:phase3
```

**4. Phase 4 Certificate Generation Test Suite (10 Scenarios Passing):**
```bash
docker exec certiflow-backend npm run test:phase4
```

**5. Phase 5 WhatsApp Certificate Delivery Test Suite (12 Scenarios Passing):**
```bash
docker exec certiflow-backend npm run test:phase5
```

**6. Phase 6 Public Verification & Cancellation Test Suite (15 Scenarios Passing):**
```bash
docker exec certiflow-backend npm run test:phase6
```

**7. Phase 7 Complete End-to-End System Lifecycle Test:**
```bash
docker exec certiflow-backend npx tsx tests/e2e.test.ts
# Or on host: npm run test:e2e --prefix apps/backend
```

**Total Automated Tests**: **76 / 76 Passing (66 Backend Integration Tests + 10 Frontend Tests)**

---

## 11. Hackathon Demonstration Workflow

Follow this step-by-step walkthrough to demonstrate the full capabilities of CertiFlow:

### Step 1: Login as Training Centre (Anika)
1. Switch to **Anika (TC-DELHI-001)** via the role switcher at the top.
2. Click **"New Batch"** and create a batch (e.g. `Solar Technician Certification`).
3. Upload student data using the provided `.xlsx` or `.csv` template.
4. Observe strict atomic validation: any formatting or duplicate errors reject the entire file with row numbers; valid files save atomically.
5. Click **"Submit Batch"** to submit the batch for District Review.

### Step 2: District Officer Approvals
1. Switch to **Dev (District Officer 1)**.
2. Open the submitted batch and click **"Approve (District)"**. The approval count increments to 1 of 2.
3. Switch to **Kabir (District Officer 2, distinct officer in North District)**.
4. Click **"Approve (District)"**. Because two distinct officers have approved, the batch advances to State Review.

### Step 3: State Officer Final Approval & Certificate Generation
1. Switch to **Farah (State Officer)**.
2. Review the batch and click **"Final State Approval"**. The batch status becomes `APPROVED`.
3. Click **"Generate Official Certificates"**.
4. The generation queue processes in the background: status moves to `PROCESSING` $\rightarrow$ `ISSUED`.
5. Click **"Preview"** or **"PDF"** to view and download the official certificate containing CertiFlow gold-embossed layout and QR code.

### Step 4: WhatsApp Simulated Delivery
1. Click **"Deliver via WhatsApp"** or switch to the **"WhatsApp Delivery"** tab.
2. Watch notifications dispatch to candidate mobile numbers.
3. Inspect delivery metrics (Sent, Queued, Failures) and review the **Live WhatsApp Simulator Messages** ledger with generated download links and masked phones (`98****3210`).

### Step 5: Public Certificate Verification (No Login Required)
1. Copy any Certificate Number (e.g. `CERT-2026-XXXXXXXX`) from the Certificates table.
2. Click the **"Public Verification"** tab in the navigation bar.
3. Paste the Certificate Number and click **"Verify Credential"**.
4. Observe the green **`VALID CREDENTIAL`** badge, candidate details, training period, and state registry verification seal.

### Step 6: Certificate Cancellation & Re-Verification
1. Switch back to **Farah (State Officer)** and return to the batch's **Certificates** tab.
2. Click **"Cancel"** on one of the certificates.
3. Enter an official cancellation reason: `"Candidate failed mandatory post-issuance competency verification."` and confirm.
4. Return to the **"Public Verification"** portal and re-verify the cancelled certificate.
5. Observe the status immediately transition to **`CANCELLED`** displaying the official cancellation reason and date.
