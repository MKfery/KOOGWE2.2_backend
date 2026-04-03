// src/documents/documents.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const REQUIRED_DRIVER_DOCS: DocumentType[] = [
  DocumentType.ID_CARD_FRONT,
  DocumentType.ID_CARD_BACK,
  DocumentType.SELFIE_WITH_ID,
  DocumentType.DRIVERS_LICENSE,
  DocumentType.VEHICLE_REGISTRATION,
  DocumentType.INSURANCE,
];

@Injectable()
export class DocumentsService {
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor(private prisma: PrismaService) {}

  private getPublicBaseUrl() {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.trim();
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    return `http://localhost:${process.env.PORT || 3000}`;
  }

  private resolveFileUrl(fileUrl: string) {
    if (!fileUrl) return fileUrl;
    if (fileUrl.startsWith('http://localhost') || fileUrl.startsWith('https://localhost')) {
      const idx = fileUrl.indexOf('/uploads/');
      if (idx >= 0) return `${this.getPublicBaseUrl()}${fileUrl.slice(idx)}`;
    }
    return fileUrl;
  }

  private mapDoc<T extends { fileUrl: string; user?: any }>(doc: T) {
    const resolved = { ...doc, fileUrl: this.resolveFileUrl(doc.fileUrl) };
    return {
      ...resolved,
      url: resolved.fileUrl,
      uploaderName: resolved.user?.firstName || resolved.user?.email || 'Inconnu',
      uploaderEmail: resolved.user?.email ?? null,
      uploaderId: resolved.user?.id ?? null,
    };
  }

  private parseDocType(type: string): DocumentType {
    const val = (DocumentType as any)[(type || '').toUpperCase()];
    if (!val) throw new BadRequestException('Type de document invalide');
    return val;
  }

  private toDocStatus(status?: string, approved?: boolean): DocumentStatus {
    if (typeof approved === 'boolean') return approved ? DocumentStatus.APPROVED : DocumentStatus.REJECTED;
    const n = (status || '').toUpperCase();
    if (['APPROVED', 'APPROVE', 'VALIDATED'].includes(n)) return DocumentStatus.APPROVED;
    if (['REJECTED', 'REJECT', 'REFUSED'].includes(n)) return DocumentStatus.REJECTED;
    throw new BadRequestException('Status doit être APPROVED ou REJECTED');
  }

  private hasAllRequired(docs: Array<{ type: DocumentType; status: DocumentStatus }>) {
    return REQUIRED_DRIVER_DOCS.every((r) => docs.some((d) => d.type === r && d.status === DocumentStatus.APPROVED));
  }

  async uploadBase64Document(params: { userId: string; type: string; imageBase64: string }) {
    const { userId, type, imageBase64 } = params;
    if (!imageBase64 || imageBase64.length < 100) throw new BadRequestException('Image invalide');

    const docType = this.parseDocType(type);
    const match = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = match?.[1] ?? 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.byteLength > 8 * 1024 * 1024) throw new BadRequestException('Document trop volumineux (max 8MB)');

    const dir = join(this.uploadsRoot, 'documents', userId, docType);
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFile(join(dir, fileName), buffer);
    const fileUrl = `${this.getPublicBaseUrl()}/uploads/documents/${userId}/${docType}/${fileName}`;

    const document = await this.prisma.document.create({
      data: { userId, type: docType, fileUrl, status: 'PENDING' },
    });

    await this.prisma.driverProfile.update({
      where: { userId },
      data: { documentsUploaded: true, documentsUploadedAt: new Date() },
    }).catch(() => undefined);

    return { success: true, message: 'Document envoyé', documentId: document.id, fileUrl, type: docType, status: document.status };
  }

  async listPendingDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.PENDING },
      include: { user: { select: { id: true, email: true, firstName: true, role: true, accountStatus: true } } },
      orderBy: { uploadedAt: 'asc' },
    });
    return docs.map((d) => this.mapDoc(d));
  }

  async listApprovedDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.APPROVED },
      include: { user: { select: { id: true, email: true, firstName: true, role: true } } },
      orderBy: { reviewedAt: 'desc' },
      take: 300,
    });
    return docs.map((d) => this.mapDoc(d));
  }

  async getDocumentsByStatus(status?: string) {
    const n = (status || '').toUpperCase();
    if (n === 'APPROVED') return this.listApprovedDocuments();
    if (n === 'REJECTED') {
      const docs = await this.prisma.document.findMany({
        where: { status: DocumentStatus.REJECTED },
        include: { user: { select: { id: true, email: true, firstName: true, role: true } } },
        orderBy: { reviewedAt: 'desc' }, take: 300,
      });
      return docs.map((d) => this.mapDoc(d));
    }
    return this.listPendingDocuments();
  }

  async reviewDocument(params: { documentId: string; adminId: string; status?: string; approved?: boolean; rejectionReason?: string }) {
    const { documentId, adminId, status, approved, rejectionReason } = params;
    const targetStatus = this.toDocStatus(status, approved);

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document introuvable');

    const reviewed = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: targetStatus,
        reviewedAt: new Date(),
        reviewedBy: adminId,
        rejectionReason: targetStatus === DocumentStatus.REJECTED ? (rejectionReason ?? 'Document non conforme') : null,
      },
    });

    await this.refreshDriverState(doc.userId);
    return { success: true, message: targetStatus === DocumentStatus.APPROVED ? 'Document approuvé ✅' : 'Document rejeté ❌', document: reviewed };
  }

  // ✅ FIX V2: approveDriver vérifie les documents AVANT de valider
  async decideDriverAccount(params: { driverId: string; adminId: string; approved: boolean; adminNotes?: string }) {
    const { driverId, approved, adminNotes } = params;
    const user = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { driverProfile: true, documents: true },
    });
    if (!user || user.role !== 'DRIVER' || !user.driverProfile) throw new NotFoundException('Chauffeur introuvable');

    if (approved) {
      if (!user.driverProfile.faceVerified) throw new BadRequestException('La vérification faciale doit être complétée');
      if (!user.driverProfile.vehicleMake || !user.driverProfile.vehicleModel || !user.driverProfile.licensePlate) {
        throw new BadRequestException('Les informations véhicule doivent être renseignées');
      }
      if (!this.hasAllRequired(user.documents)) {
        throw new BadRequestException('Tous les documents requis doivent être approuvés (carte ID recto/verso, selfie, permis, carte grise, assurance)');
      }
    }

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: { adminApproved: approved, adminApprovedAt: approved ? new Date() : null, adminNotes: adminNotes ?? null },
    });
    await this.prisma.user.update({
      where: { id: driverId },
      data: { accountStatus: approved ? 'ACTIVE' : 'REJECTED', isVerified: approved },
    });

    return { success: true, message: approved ? 'Compte chauffeur validé ✅' : 'Compte chauffeur rejeté ❌' };
  }

  private async refreshDriverState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true, documents: true },
    });
    if (!user || user.role !== 'DRIVER' || !user.driverProfile) return;

    const allApproved = this.hasAllRequired(user.documents);
    const hasVehicle = user.driverProfile.vehicleMake && user.driverProfile.vehicleModel && user.driverProfile.licensePlate;
    const faceOk = user.driverProfile.faceVerified;

    if (allApproved && hasVehicle && faceOk) {
      await this.prisma.driverProfile.update({ where: { userId }, data: { adminApproved: true, adminApprovedAt: new Date() } });
      await this.prisma.user.update({ where: { id: userId }, data: { accountStatus: 'ACTIVE', isVerified: true } });
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { accountStatus: 'ADMIN_REVIEW_PENDING' as any } }).catch(() => {});
    }
  }
}
