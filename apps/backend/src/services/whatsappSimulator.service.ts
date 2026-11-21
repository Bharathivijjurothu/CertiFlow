import crypto from 'crypto';

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
  timestamp: Date;
}

export interface SendWhatsAppInput {
  recipientPhone: string;
  studentName: string;
  courseName: string;
  certificateNumber: string;
  accessUrl: string;
  failSimulated?: boolean;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  maskedPhone: string;
  deliveredAt?: Date;
  error?: string;
  errorCode?: string;
  isPermanent?: boolean;
}

/**
 * Masks a phone number for data privacy (e.g. "9876543210" -> "98****3210")
 */
export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '****';
  const first = cleaned.slice(0, 2);
  const last = cleaned.slice(-4);
  return `${first}${'*'.repeat(Math.max(2, cleaned.length - 6))}${last}`;
}

// In-memory ledger of simulated messages for UI demonstration & audit inspection
const simulatedMessageStore: SimulatedWhatsAppMessage[] = [];
const MAX_STORED_MESSAGES = 200;

export class WhatsAppSimulator {
  /**
   * Simulates sending a WhatsApp certificate notification.
   * NEVER makes real network calls or transmits real messages.
   */
  static async sendMessage(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
    const { recipientPhone, studentName, courseName, certificateNumber, accessUrl, failSimulated } = input;
    const masked = maskPhoneNumber(recipientPhone);

    // 1. Validation check for phone format (permanent error)
    const cleanedDigits = recipientPhone.replace(/\D/g, '');
    if (cleanedDigits.length < 10) {
      return {
        success: false,
        maskedPhone: masked,
        error: `Invalid phone number format: '${masked}' contains fewer than 10 digits.`,
        errorCode: 'INVALID_PHONE_NUMBER',
        isPermanent: true
      };
    }

    // 2. Deterministic / simulated failure check
    // If failSimulated is true or phone ends with "9999", trigger simulated provider timeout
    const isSimulatedFailure = failSimulated === true || cleanedDigits.endsWith('9999');

    const messageBody = `🎓 CertiFlow Official Notice: Dear ${studentName}, your certificate for ${courseName} (Cert No: ${certificateNumber}) has been issued. View and download your credential: ${accessUrl}`;

    if (isSimulatedFailure) {
      const failedMsg: SimulatedWhatsAppMessage = {
        messageId: `WAMID.FAIL.${Date.now()}`,
        recipientPhone,
        maskedPhone: masked,
        studentName,
        courseName,
        certificateNumber,
        body: messageBody,
        status: 'FAILED',
        error: 'SIMULATED_CARRIER_TIMEOUT: Simulated WhatsApp gateway timeout',
        timestamp: new Date()
      };

      WhatsAppSimulator.recordMessage(failedMsg);

      return {
        success: false,
        maskedPhone: masked,
        error: 'SIMULATED_CARRIER_TIMEOUT: Simulated WhatsApp gateway timeout',
        errorCode: 'GATEWAY_TIMEOUT',
        isPermanent: false
      };
    }

    // 3. Simulated Successful Delivery
    const messageId = `WAMID.SIMULATED.${Date.now()}.${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const deliveredAt = new Date();

    const successMsg: SimulatedWhatsAppMessage = {
      messageId,
      recipientPhone,
      maskedPhone: masked,
      studentName,
      courseName,
      certificateNumber,
      body: messageBody,
      status: 'DELIVERED',
      timestamp: deliveredAt
    };

    WhatsAppSimulator.recordMessage(successMsg);

    return {
      success: true,
      messageId,
      maskedPhone: masked,
      deliveredAt
    };
  }

  private static recordMessage(msg: SimulatedWhatsAppMessage) {
    simulatedMessageStore.unshift(msg);
    if (simulatedMessageStore.length > MAX_STORED_MESSAGES) {
      simulatedMessageStore.pop();
    }
  }

  /**
   * Retrieves the recent ledger of simulated messages.
   */
  static getRecentMessages(limit: number = 50): SimulatedWhatsAppMessage[] {
    return simulatedMessageStore.slice(0, limit);
  }

  /**
   * Clears the simulated ledger (useful for automated testing).
   */
  static clearStore(): void {
    simulatedMessageStore.length = 0;
  }
}
