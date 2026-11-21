import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export interface GenerateCertificatePdfInput {
  certificateNumber: string;
  studentName: string;
  courseName: string;
  batchNumber: string;
  trainingCentreId: string;
  districtId: string;
  trainingStartDate: Date;
  trainingEndDate: Date;
  issueDate: Date;
  grade?: string | null;
  qrCodeBuffer: Buffer;
  outputPath: string;
}

export function generateCertificatePdf(input: GenerateCertificatePdfInput): Promise<{ outputPath: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    try {
      const {
        certificateNumber,
        studentName,
        courseName,
        batchNumber,
        trainingCentreId,
        districtId,
        trainingStartDate,
        trainingEndDate,
        issueDate,
        grade,
        qrCodeBuffer,
        outputPath
      } = input;

      // Ensure destination directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      // Create PDF in A4 Landscape (841.89 x 595.28 points)
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 30, bottom: 30, left: 30, right: 30 }
      });

      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);

      const pageWidth = 841.89;
      const pageHeight = 595.28;

      // =======================================================================
      // 1. Elegant Borders
      // =======================================================================
      // Outer Navy Frame
      doc
        .rect(20, 20, pageWidth - 40, pageHeight - 40)
        .lineWidth(3.5)
        .strokeColor('#0f172a')
        .stroke();

      // Inner Gold Accent Frame
      doc
        .rect(28, 28, pageWidth - 56, pageHeight - 56)
        .lineWidth(1.5)
        .strokeColor('#d97706')
        .stroke();

      // Corner Accents
      const cornerSize = 14;
      const drawCorner = (x: number, y: number) => {
        doc.rect(x, y, cornerSize, cornerSize).fillColor('#d97706').fill();
      };
      drawCorner(28, 28);
      drawCorner(pageWidth - 28 - cornerSize, 28);
      drawCorner(28, pageHeight - 28 - cornerSize);
      drawCorner(pageWidth - 28 - cornerSize, pageHeight - 28 - cornerSize);

      // =======================================================================
      // 2. Header & Branding
      // =======================================================================
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#64748b')
        .text('CERTIFLOW • SKILLING & VERIFICATION REGISTRY', 0, 52, {
          align: 'center',
          characterSpacing: 2
        });

      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor('#94a3b8')
        .text('DIRECTORATE OF VOCATIONAL TRAINING & WORKFORCE EMPOWERMENT', 0, 68, {
          align: 'center',
          characterSpacing: 1.5
        });

      // Divider line
      doc
        .moveTo(220, 85)
        .lineTo(pageWidth - 220, 85)
        .lineWidth(0.75)
        .strokeColor('#cbd5e1')
        .stroke();

      // =======================================================================
      // 3. Certificate Title
      // =======================================================================
      doc
        .fontSize(23)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('CERTIFICATE OF SKILLING & ACHIEVEMENT', 0, 105, {
          align: 'center',
          characterSpacing: 1
        });

      doc
        .fontSize(12)
        .font('Helvetica-Oblique')
        .fillColor('#475569')
        .text('This is to certify that', 0, 142, {
          align: 'center'
        });

      // =======================================================================
      // 4. Student Name (Dynamic Font Scaling for Long Names)
      // =======================================================================
      const nameLength = studentName.length;
      const nameFontSize = nameLength > 35 ? 19 : nameLength > 24 ? 22 : 26;

      doc
        .fontSize(nameFontSize)
        .font('Helvetica-Bold')
        .fillColor('#1e3a8a')
        .text(studentName.toUpperCase(), 40, 168, {
          align: 'center',
          width: pageWidth - 80
        });

      // Decorative under-line under student name
      const textWidth = Math.min(doc.widthOfString(studentName.toUpperCase()), pageWidth - 160);
      const lineStart = (pageWidth - textWidth) / 2;
      doc
        .moveTo(lineStart - 15, 198)
        .lineTo(lineStart + textWidth + 15, 198)
        .lineWidth(1)
        .strokeColor('#d97706')
        .stroke();

      // =======================================================================
      // 5. Completion Statement & Course
      // =======================================================================
      doc
        .fontSize(11)
        .font('Helvetica')
        .fillColor('#334155')
        .text(
          'has successfully completed all prescribed training modules, competency assessments, and vocational requirements for',
          60,
          214,
          { align: 'center', width: pageWidth - 120, lineGap: 3 }
        );

      const courseFontSize = courseName.length > 45 ? 15 : 18;
      doc
        .fontSize(courseFontSize)
        .font('Helvetica-Bold')
        .fillColor('#047857')
        .text(courseName, 50, 248, {
          align: 'center',
          width: pageWidth - 100
        });

      // =======================================================================
      // 6. Training Details Grid (Centre, District, Dates, Grade)
      // =======================================================================
      const startStr = trainingStartDate.toISOString().split('T')[0];
      const endStr = trainingEndDate.toISOString().split('T')[0];
      const detailsY = 285;

      // Grey details pill box
      doc
        .roundedRect(120, detailsY, pageWidth - 240, 52, 6)
        .fillColor('#f8fafc')
        .fillAndStroke('#e2e8f0');

      doc
        .fontSize(9.5)
        .font('Helvetica-Bold')
        .fillColor('#475569')
        .text('Training Centre:', 140, detailsY + 12)
        .font('Helvetica')
        .fillColor('#0f172a')
        .text(`${trainingCentreId}`, 230, detailsY + 12);

      doc
        .fontSize(9.5)
        .font('Helvetica-Bold')
        .fillColor('#475569')
        .text('District / Region:', 140, detailsY + 28)
        .font('Helvetica')
        .fillColor('#0f172a')
        .text(`${districtId}`, 230, detailsY + 28);

      doc
        .fontSize(9.5)
        .font('Helvetica-Bold')
        .fillColor('#475569')
        .text('Training Period:', 440, detailsY + 12)
        .font('Helvetica')
        .fillColor('#0f172a')
        .text(`${startStr} to ${endStr}`, 530, detailsY + 12);

      doc
        .fontSize(9.5)
        .font('Helvetica-Bold')
        .fillColor('#475569')
        .text('Batch Ref & Grade:', 440, detailsY + 28)
        .font('Helvetica')
        .fillColor('#0f172a')
        .text(`${batchNumber} • Grade: ${grade || 'Completed'}`, 545, detailsY + 28);

      // =======================================================================
      // 7. Footer: QR Code, Certificate Number, Signatures
      // =======================================================================
      const footerY = 380;

      // Left: QR Code (Embedded Image)
      doc.image(qrCodeBuffer, 65, footerY - 5, { width: 85, height: 85 });
      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor('#64748b')
        .text('SCAN TO VERIFY', 60, footerY + 85, { width: 95, align: 'center' });

      // Center: Official Record & Cert ID
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#475569')
        .text('Certificate Identifier:', 220, footerY + 15, { align: 'center', width: pageWidth - 440 });

      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(certificateNumber, 220, footerY + 28, { align: 'center', width: pageWidth - 440 });

      const issueStr = issueDate.toISOString().split('T')[0];
      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor('#64748b')
        .text(`Date of Issuance: ${issueStr}`, 220, footerY + 46, { align: 'center', width: pageWidth - 440 })
        .text('Digitally registered in official state credential repository', 220, footerY + 59, { align: 'center', width: pageWidth - 440 });

      // Right: Signatures
      const sigLineY = footerY + 50;
      doc
        .moveTo(pageWidth - 230, sigLineY)
        .lineTo(pageWidth - 65, sigLineY)
        .lineWidth(1)
        .strokeColor('#94a3b8')
        .stroke();

      doc
        .fontSize(8.5)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text('State Officer & Verification Authority', pageWidth - 230, sigLineY + 6, {
          width: 165,
          align: 'center'
        });

      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor('#64748b')
        .text('Directorate of Skilling & Issuance', pageWidth - 230, sigLineY + 18, {
          width: 165,
          align: 'center'
        });

      // Finalize PDF document
      doc.end();

      writeStream.on('finish', () => {
        const stats = fs.statSync(outputPath);
        resolve({
          outputPath,
          sizeBytes: stats.size
        });
      });

      writeStream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}
