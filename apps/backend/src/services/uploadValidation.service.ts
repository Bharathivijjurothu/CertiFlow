import * as xlsx from 'xlsx';
import { prisma } from '../config/db';
import { config } from '../config/env';

export interface ValidationErrorItem {
  row: number; // 1-based Excel row number (row 1 is header, data starts row 2)
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

export interface ParsedStudentRow {
  studentName: string;
  email: string;
  phone: string;
  governmentId?: string;
  dateOfBirth?: string;
  gender?: string;
  grade?: string;
}

// Canonical required and optional headers
export const REQUIRED_COLUMNS = ['Student Name', 'Email', 'Phone'];
export const OPTIONAL_COLUMNS = ['Government ID', 'Date of Birth', 'Gender', 'Grade'];
export const ALL_ALLOWED_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^(?:\+?91[\s-]?)?[6-9]\d{9}$/;

export function normalizeHeader(header: string): string {
  const cleaned = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleaned.includes('studentname') || cleaned === 'name') return 'Student Name';
  if (cleaned.includes('email') || cleaned === 'emailid') return 'Email';
  if (cleaned.includes('phone') || cleaned.includes('mobile') || cleaned.includes('contact')) return 'Phone';
  if (cleaned.includes('governmentid') || cleaned.includes('govtid') || cleaned.includes('aadhaar') || cleaned === 'id') return 'Government ID';
  if (cleaned.includes('dateofbirth') || cleaned === 'dob') return 'Date of Birth';
  if (cleaned === 'gender' || cleaned === 'sex') return 'Gender';
  if (cleaned === 'grade' || cleaned === 'score' || cleaned === 'result') return 'Grade';
  return header.trim();
}

export function generateTemplate(format: 'csv' | 'xlsx'): { buffer: Buffer; mimeType: string; filename: string } {
  const headers = ALL_ALLOWED_COLUMNS;
  const sampleData = [
    {
      'Student Name': 'Aarav Sharma',
      'Email': 'aarav.sharma@example.com',
      'Phone': '9876543210',
      'Government ID': 'GOV-IND-1001',
      'Date of Birth': '2002-05-15',
      'Gender': 'Male',
      'Grade': 'A'
    },
    {
      'Student Name': 'Priya Patel',
      'Email': 'priya.patel@example.com',
      'Phone': '9876543211',
      'Government ID': 'GOV-IND-1002',
      'Date of Birth': '2001-11-20',
      'Gender': 'Female',
      'Grade': 'A+'
    },
    {
      'Student Name': 'Rohan Verma',
      'Email': 'rohan.verma@example.com',
      'Phone': '9876543212',
      'Government ID': 'GOV-IND-1003',
      'Date of Birth': '2003-02-10',
      'Gender': 'Male',
      'Grade': 'B'
    }
  ];

  const ws = xlsx.utils.json_to_sheet(sampleData, { header: headers });
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Students');

  if (format === 'csv') {
    const csvContent = xlsx.utils.sheet_to_csv(ws);
    return {
      buffer: Buffer.from(csvContent, 'utf-8'),
      mimeType: 'text/csv',
      filename: 'certiflow_students_template.csv'
    };
  }

  const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return {
    buffer: xlsxBuffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: 'certiflow_students_template.xlsx'
  };
}

export async function parseAndValidateUpload(
  fileBuffer: Buffer,
  originalFilename: string,
  batchId: string
): Promise<{ report: ValidationReport; validRows: ParsedStudentRow[] }> {
  const errors: ValidationErrorItem[] = [];

  // 1. File extension validation
  const lowerName = originalFilename.toLowerCase();
  const isXlsx = lowerName.endsWith('.xlsx');
  const isXls = lowerName.endsWith('.xls');
  const isCsv = lowerName.endsWith('.csv');

  if (!isXlsx && !isXls && !isCsv) {
    errors.push({
      row: 0,
      field: 'File',
      code: 'INVALID_FILE_TYPE',
      message: `Invalid file extension. Only .xlsx, .xls, and .csv files are supported. Received: '${originalFilename}'`
    });
    return {
      report: {
        valid: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0, errorCount: 1 },
        errors
      },
      validRows: []
    };
  }

  // 2. File size validation
  if (fileBuffer.length > config.maxUploadSizeBytes) {
    errors.push({
      row: 0,
      field: 'File',
      code: 'EXCEEDS_FILE_SIZE_LIMIT',
      message: `File size exceeds the maximum allowed limit of ${Math.round(config.maxUploadSizeBytes / (1024 * 1024))}MB`
    });
    return {
      report: {
        valid: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0, errorCount: 1 },
        errors
      },
      validRows: []
    };
  }

  // 3. Parse file
  let workbook: xlsx.WorkBook;
  try {
    workbook = xlsx.read(fileBuffer, { type: 'buffer', raw: false });
  } catch (err) {
    errors.push({
      row: 0,
      field: 'File',
      code: 'FILE_CORRUPTED',
      message: 'Unable to parse the uploaded file. Please ensure it is a valid Excel or CSV document.'
    });
    return {
      report: {
        valid: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0, errorCount: 1 },
        errors
      },
      validRows: []
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    errors.push({
      row: 0,
      field: 'File',
      code: 'EMPTY_WORKBOOK',
      message: 'Workbook contains no sheets.'
    });
    return {
      report: {
        valid: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0, errorCount: 1 },
        errors
      },
      validRows: []
    };
  }

  const worksheet = workbook.Sheets[sheetName];
  // Parse raw rows including headers
  const rawRows: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

  if (rawRows.length === 0) {
    errors.push({
      row: 1,
      field: 'Headers',
      code: 'EMPTY_FILE',
      message: 'The uploaded file contains no data or headers.'
    });
    return {
      report: {
        valid: false,
        summary: { totalRows: 0, validRows: 0, invalidRows: 0, errorCount: 1 },
        errors
      },
      validRows: []
    };
  }

  // 4. Validate Headers
  const headerRow = rawRows[0] as string[];
  const normalizedHeaderMap: Record<number, string> = {};
  const presentNormalizedHeaders = new Set<string>();

  headerRow.forEach((col, idx) => {
    if (col && typeof col === 'string') {
      const norm = normalizeHeader(col);
      normalizedHeaderMap[idx] = norm;
      presentNormalizedHeaders.add(norm);
    }
  });

  // Check required columns
  for (const required of REQUIRED_COLUMNS) {
    if (!presentNormalizedHeaders.has(required)) {
      errors.push({
        row: 1,
        field: required,
        code: 'MISSING_REQUIRED_COLUMN',
        message: `Missing required column: '${required}'. Expected columns: ${REQUIRED_COLUMNS.join(', ')}`
      });
    }
  }

  const dataRows = rawRows.slice(1);
  const totalDataRows = dataRows.length;

  if (totalDataRows === 0) {
    errors.push({
      row: 1,
      field: 'Data',
      code: 'NO_STUDENT_DATA',
      message: 'File has headers but contains zero student rows.'
    });
  }

  // Check maximum row count limit
  if (totalDataRows > config.maxUploadRows) {
    errors.push({
      row: 1,
      field: 'Data',
      code: 'EXCEEDS_ROW_LIMIT',
      message: `File contains ${totalDataRows} rows, which exceeds the maximum limit of ${config.maxUploadRows} rows.`
    });
  }

  // If header errors exist, abort row validation
  if (errors.length > 0) {
    return {
      report: {
        valid: false,
        summary: {
          totalRows: totalDataRows,
          validRows: 0,
          invalidRows: totalDataRows,
          errorCount: errors.length
        },
        errors
      },
      validRows: []
    };
  }

  // 5. In-file duplicate trackers & Existing batch students check
  const seenEmails = new Map<string, number>(); // email -> first row
  const seenPhones = new Map<string, number>(); // phone -> first row

  // Query existing students in this batch (if any) to check duplicates against batch
  const existingBatchStudents = await prisma.student.findMany({
    where: { batchId },
    select: { email: true, studentName: true }
  });
  const existingEmailSet = new Set(existingBatchStudents.map((s) => s.email.toLowerCase()));

  const validRowsList: ParsedStudentRow[] = [];
  const rowsWithErrors = new Set<number>();

  // 6. Row-by-row validation
  dataRows.forEach((rowValues, index) => {
    const excelRow = index + 2; // Row 1 is header, row 2 is first data row

    // Extract values according to mapped columns
    const rowObj: Record<string, string> = {};
    Object.entries(normalizedHeaderMap).forEach(([idxStr, colName]) => {
      const val = rowValues[parseInt(idxStr, 10)];
      rowObj[colName] = val !== undefined && val !== null ? String(val).trim() : '';
    });

    const studentName = rowObj['Student Name'] || '';
    const email = (rowObj['Email'] || '').toLowerCase();
    const phone = (rowObj['Phone'] || '').replace(/\D/g, ''); // Extract digits
    const governmentId = rowObj['Government ID'] || '';
    const dateOfBirth = rowObj['Date of Birth'] || '';
    const gender = rowObj['Gender'] || '';
    const grade = rowObj['Grade'] || '';

    // Check if completely empty row
    const isAllEmpty = Object.values(rowObj).every((v) => v === '');
    if (isAllEmpty) {
      errors.push({
        row: excelRow,
        field: 'Row',
        code: 'EMPTY_ROW',
        message: `Row ${excelRow} is completely empty.`
      });
      rowsWithErrors.add(excelRow);
      return;
    }

    let hasRowError = false;

    // Student Name validation
    if (!studentName || studentName.length < 2) {
      errors.push({
        row: excelRow,
        field: 'Student Name',
        code: 'MISSING_STUDENT_NAME',
        message: 'Student name is required and must be at least 2 characters.'
      });
      hasRowError = true;
    }

    // Email validation
    if (!email) {
      errors.push({
        row: excelRow,
        field: 'Email',
        code: 'MISSING_EMAIL',
        message: 'Student email is required.'
      });
      hasRowError = true;
    } else if (!EMAIL_REGEX.test(email)) {
      errors.push({
        row: excelRow,
        field: 'Email',
        code: 'INVALID_EMAIL',
        message: `Invalid email address format: '${rowObj['Email']}'.`
      });
      hasRowError = true;
    } else {
      // In-file duplicate email check
      if (seenEmails.has(email)) {
        const prevRow = seenEmails.get(email)!;
        errors.push({
          row: excelRow,
          field: 'Email',
          code: 'DUPLICATE_EMAIL_IN_FILE',
          message: `Duplicate email '${email}' found in this file (previously seen on row ${prevRow}).`
        });
        hasRowError = true;
      } else {
        seenEmails.set(email, excelRow);
      }
    }

    // Phone validation
    if (!phone) {
      errors.push({
        row: excelRow,
        field: 'Phone',
        code: 'MISSING_PHONE',
        message: 'Phone number is required.'
      });
      hasRowError = true;
    } else if (!PHONE_REGEX.test(phone)) {
      errors.push({
        row: excelRow,
        field: 'Phone',
        code: 'INVALID_PHONE',
        message: `Phone number must be a valid 10-digit mobile number: '${rowObj['Phone']}'.`
      });
      hasRowError = true;
    } else {
      // In-file duplicate phone check
      if (seenPhones.has(phone)) {
        const prevRow = seenPhones.get(phone)!;
        errors.push({
          row: excelRow,
          field: 'Phone',
          code: 'DUPLICATE_PHONE_IN_FILE',
          message: `Duplicate phone number '${phone}' found in this file (previously seen on row ${prevRow}).`
        });
        hasRowError = true;
      } else {
        seenPhones.set(phone, excelRow);
      }
    }

    if (hasRowError) {
      rowsWithErrors.add(excelRow);
    } else {
      validRowsList.push({
        studentName,
        email,
        phone,
        governmentId: governmentId || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        grade: grade || undefined
      });
    }
  });

  const invalidRowsCount = rowsWithErrors.size;
  const validRowsCount = totalDataRows - invalidRowsCount;
  const isValid = errors.length === 0;

  return {
    report: {
      valid: isValid,
      summary: {
        totalRows: totalDataRows,
        validRows: isValid ? totalDataRows : validRowsCount,
        invalidRows: invalidRowsCount,
        errorCount: errors.length
      },
      errors
    },
    validRows: isValid ? validRowsList : []
  };
}
