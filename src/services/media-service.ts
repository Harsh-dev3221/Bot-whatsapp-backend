import type { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';

/**
 * Media Service
 * Handles sending different types of media through WhatsApp
 */
export class MediaService {
  /**
   * Send a location message
   */
  static async sendLocation(
    sock: WASocket,
    jid: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        location: {
          degreesLatitude: latitude,
          degreesLongitude: longitude,
          name: name || 'Location',
          address: address || '',
        },
      });

      logger.info({ jid, latitude, longitude, name }, 'Location sent');
    } catch (error) {
      logger.error({ err: String(error), jid }, 'Error sending location');
      throw error;
    }
  }

  /**
   * Send an image message
   */
  static async sendImage(
    sock: WASocket,
    jid: string,
    imageUrl: string,
    caption?: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: caption || '',
      });

      logger.info({ jid, imageUrl, caption }, 'Image sent');
    } catch (error) {
      logger.error({ err: String(error), jid, imageUrl }, 'Error sending image');
      throw error;
    }
  }

  /**
   * Send a video message
   */
  static async sendVideo(
    sock: WASocket,
    jid: string,
    videoUrl: string,
    caption?: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        video: { url: videoUrl },
        caption: caption || '',
      });

      logger.info({ jid, videoUrl, caption }, 'Video sent');
    } catch (error) {
      logger.error({ err: String(error), jid, videoUrl }, 'Error sending video');
      throw error;
    }
  }

  /**
   * Send a document message
   */
  static async sendDocument(
    sock: WASocket,
    jid: string,
    documentUrl: string,
    fileName: string,
    mimeType?: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        document: { url: documentUrl },
        fileName: fileName,
        mimetype: mimeType || 'application/pdf',
      });

      logger.info({ jid, documentUrl, fileName }, 'Document sent');
    } catch (error) {
      logger.error({ err: String(error), jid, documentUrl }, 'Error sending document');
      throw error;
    }
  }

  /**
   * Send a contact message
   */
  static async sendContact(
    sock: WASocket,
    jid: string,
    displayName: string,
    vcard: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        contacts: {
          displayName: displayName,
          contacts: [{ vcard: vcard }],
        },
      });

      logger.info({ jid, displayName }, 'Contact sent');
    } catch (error) {
      logger.error({ err: String(error), jid, displayName }, 'Error sending contact');
      throw error;
    }
  }

  /**
   * Create a vCard string
   */
  static createVCard(
    name: string,
    phone: string,
    email?: string,
    organization?: string
  ): string {
    let vcard = 'BEGIN:VCARD\n';
    vcard += 'VERSION:3.0\n';
    vcard += `FN:${name}\n`;
    vcard += `TEL;type=CELL;type=VOICE;waid=${phone.replace(/\D/g, '')}:${phone}\n`;
    
    if (email) {
      vcard += `EMAIL:${email}\n`;
    }
    
    if (organization) {
      vcard += `ORG:${organization}\n`;
    }
    
    vcard += 'END:VCARD';
    
    return vcard;
  }

  /**
   * Send text message (helper)
   */
  static async sendText(
    sock: WASocket,
    jid: string,
    text: string
  ): Promise<void> {
    try {
      await sock.sendMessage(jid, {
        text: text,
      });

      logger.info({ jid, text: text.substring(0, 50) }, 'Text sent');
    } catch (error) {
      logger.error({ err: String(error), jid }, 'Error sending text');
      throw error;
    }
  }
}

