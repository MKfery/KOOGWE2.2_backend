// src/admin/admin.service.ts
import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../common/websocket.gateway';
import { MailService } from '../mail/mail.service';

const REQUIRED_DRIVER_DOCS: DocumentType[] = [
  DocumentType.ID_CARD_FRONT, DocumentType.ID_CARD_BACK,
  DocumentType.SELFIE_WITH_ID, DocumentType.DRIVERS_LICENSE,
  DocumentType.VEHICLE_REGISTRATION, DocumentType.INSURANCE,
];

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService, private gateway: AppGateway, private mail: MailService) {}

  private resolveFileUrl(fileUrl: string) {
    if (!fileUrl) return fileUrl;
    if (fileUrl.startsWith('http://localhost')) {
      const idx = fileUrl.indexOf('/uploads/');
      if (idx >= 0) {
        const base = process.env.PUBLIC_BASE_URL ||
          (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
        return `${base}${fileUrl.slice(idx)}`;
      }
    }
    return fileUrl;
  }

  private mapDoc<T extends { fileUrl: string; user?: any }>(doc: T) {
    const resolved = { ...doc, fileUrl: this.resolveFileUrl(doc.fileUrl) };
    return {
      ...resolved, url: resolved.fileUrl,
      driverName: resolved.user?.firstName || resolved.user?.email || 'Inconnu',
      uploaderEmail: resolved.user?.email ?? null,
      uploaderId: resolved.user?.id ?? null,
    };
  }

  private toDocStatus(status?: string, approved?: boolean): DocumentStatus {
    if (typeof approved === 'boolean') return approved ? DocumentStatus.APPROVED : DocumentStatus.REJECTED;
    const n = (status || '').toUpperCase();
    if (['APPROVED', 'APPROVE', 'VALIDATED'].includes(n)) return DocumentStatus.APPROVED;
    if (['REJECTED', 'REJECT', 'REFUSED'].includes(n)) return DocumentStatus.REJECTED;
    throw new BadRequestException('Status doit être APPROVED ou REJECTED');
  }

  private hasAllDocs(docs: Array<{ type: DocumentType; status: DocumentStatus }>) {
    return REQUIRED_DRIVER_DOCS.every((r) => docs.some((d) => d.type === r && d.status === DocumentStatus.APPROVED));
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  async getDashboardStats() {
    const [totalDrivers, activeDrivers, pendingDrivers, totalPassengers,
      totalRides, activeRides, pendingDocs, revenue] = await Promise.all([
      this.prisma.user.count({ where: { role: 'DRIVER' } }),
      this.prisma.user.count({ where: { role: 'DRIVER', accountStatus: 'ACTIVE' } }),
      this.prisma.user.count({ where: { role: 'DRIVER', accountStatus: 'ADMIN_REVIEW_PENDING' as any } }),
      this.prisma.user.count({ where: { role: 'PASSENGER' } }),
      this.prisma.ride.count(),
      this.prisma.ride.count({ where: { status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] as any[] } } }),
      this.prisma.document.count({ where: { status: DocumentStatus.PENDING } }),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: 'PAYMENT', status: 'COMPLETED' } }),
    ]);
    return { totalDrivers, activeDrivers, pendingDrivers, totalPassengers, totalRides, activeRides, pendingDocs, revenue: revenue._sum.amount ?? 0 };
  }

  // ─── Courses ──────────────────────────────────────────────────────────────
  async getRecentRides(limit = 20) {
    return this.prisma.ride.findMany({
      include: {
        passenger: { select: { id: true, firstName: true, email: true } },
        driver: { select: { id: true, firstName: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });
  }

  async getActiveRides() {
    return this.prisma.ride.findMany({
      where: { status: { in: ['REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] as any[] } },
      include: {
        passenger: { select: { id: true, firstName: true, phone: true } },
        driver: { select: { id: true, firstName: true, phone: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ─── Chauffeurs ───────────────────────────────────────────────────────────
  async getDrivers(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'DRIVER' },
        include: { driverProfile: true, documents: true },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.user.count({ where: { role: 'DRIVER' } }),
    ]);
    return {
      page, limit, total,
      items: items.map((d) => ({
        id: d.id, email: d.email, firstName: d.firstName, phone: d.phone,
        role: d.role, accountStatus: d.accountStatus, createdAt: d.createdAt,
        faceVerified: d.driverProfile?.faceVerified ?? false,
        vehicleMake: d.driverProfile?.vehicleMake, vehicleModel: d.driverProfile?.vehicleModel,
        licensePlate: d.driverProfile?.licensePlate, rating: d.driverProfile?.rating ?? 0,
        totalRides: d.driverProfile?.totalRides ?? 0, adminApproved: d.driverProfile?.adminApproved ?? false,
        documentsSummary: {
          total: d.documents.length,
          pending: d.documents.filter((doc) => doc.status === 'PENDING').length,
          approved: d.documents.filter((doc) => doc.status === 'APPROVED').length,
          rejected: d.documents.filter((doc) => doc.status === 'REJECTED').length,
        },
      })),
    };
  }

  async getPendingDrivers() {
    const drivers = await this.prisma.user.findMany({
      where: { role: 'DRIVER', accountStatus: { in: ['ADMIN_REVIEW_PENDING', 'DOCUMENTS_PENDING'] as any[] } },
      include: { driverProfile: true, documents: { orderBy: { uploadedAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return drivers.map((d) => ({
      id: d.id, email: d.email, firstName: d.firstName, phone: d.phone,
      accountStatus: d.accountStatus, faceVerified: d.driverProfile?.faceVerified ?? false,
      driverProfile: d.driverProfile,
      documents: d.documents.map((doc) => this.mapDoc(doc as any)),
      canBeApproved: this.hasAllDocs(d.documents),
    }));
  }

  async getPassengers(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'PASSENGER' },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, accountStatus: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.user.count({ where: { role: 'PASSENGER' } }),
    ]);
    return { page, limit, total, items };
  }

  async setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    await this.prisma.user.update({ where: { id: userId }, data: { accountStatus: status as any, isActive: status === 'ACTIVE' } });
    return { success: true, accountStatus: status };
  }

  // ✅ FIX V2: setDriverApproval vérifie les documents AVANT d'approuver
  async setDriverApproval(params: { driverId: string; approved: boolean; adminNotes?: string }) {
    const { driverId, approved, adminNotes } = params;
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { driverProfile: true, documents: true },
    });
    if (!driver || driver.role !== 'DRIVER' || !driver.driverProfile) throw new NotFoundException('Chauffeur introuvable');

    if (approved) {
      if (!driver.driverProfile.faceVerified) throw new BadRequestException('Vérification faciale non complétée');
      if (!driver.driverProfile.vehicleMake || !driver.driverProfile.licensePlate) throw new BadRequestException('Informations véhicule manquantes');
      if (!this.hasAllDocs(driver.documents)) throw new BadRequestException('Tous les documents requis doivent être approuvés avant validation');
    }

    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { userId: driverId },
        data: { adminApproved: approved, adminApprovedAt: approved ? new Date() : null, adminNotes: adminNotes ?? null },
      }),
      this.prisma.user.update({
        where: { id: driverId },
        data: { accountStatus: approved ? 'ACTIVE' : 'REJECTED', isVerified: approved, isActive: approved },
      }),
    ]);

    if (approved) {
      this.gateway.emitToUser(driverId, 'account_activated', { message: 'Votre compte est maintenant actif ! Vous pouvez accepter des courses.' });
    }

    // Envoyer email de validation/refus
    this.mail.sendDriverValidation(driver.email, approved, driver.language).catch(() => {});

    return { success: true, message: approved ? 'Chauffeur approuvé et activé ✅' : 'Chauffeur refusé ❌' };
  }

  // ─── Documents ────────────────────────────────────────────────────────────
  async getPendingDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.PENDING },
      include: { user: { select: { id: true, firstName: true, email: true, role: true } } },
      orderBy: { uploadedAt: 'asc' },
    });
    return docs.map((d) => this.mapDoc(d as any));
  }

  async getApprovedDocuments() {
    const docs = await this.prisma.document.findMany({
      where: { status: DocumentStatus.APPROVED },
      include: { user: { select: { id: true, firstName: true, email: true, role: true } } },
      orderBy: { reviewedAt: 'desc' }, take: 300,
    });
    return docs.map((d) => this.mapDoc(d as any));
  }

  async getDocumentsByStatus(status?: string) {
    const n = (status || '').toUpperCase();
    if (n === 'APPROVED') return this.getApprovedDocuments();
    if (n === 'REJECTED') {
      const docs = await this.prisma.document.findMany({
        where: { status: DocumentStatus.REJECTED },
        include: { user: { select: { id: true, firstName: true, email: true, role: true } } },
        orderBy: { reviewedAt: 'desc' }, take: 300,
      });
      return docs.map((d) => this.mapDoc(d as any));
    }
    return this.getPendingDocuments();
  }

  async reviewDocument(params: { documentId: string; adminId: string; status?: string; approved?: boolean; rejectionReason?: string }) {
    const targetStatus = this.toDocStatus(params.status, params.approved);
    const doc = await this.prisma.document.findUnique({ where: { id: params.documentId } });
    if (!doc) throw new NotFoundException('Document introuvable');

    const updated = await this.prisma.document.update({
      where: { id: params.documentId },
      data: { status: targetStatus, reviewedAt: new Date(), reviewedBy: params.adminId, rejectionReason: targetStatus === 'REJECTED' ? (params.rejectionReason ?? 'Non conforme') : null },
      include: { user: { select: { id: true, firstName: true, email: true } } },
    });

    return { ...this.mapDoc(updated as any), message: targetStatus === 'APPROVED' ? 'Document approuvé ✅' : 'Document rejeté ❌' };
  }

  // ─── Finances ─────────────────────────────────────────────────────────────
  async getFinanceStats() {
    const [total, recharges, payments, withdrawals, pending] = await Promise.all([
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: 'RECHARGE', status: 'COMPLETED' } }),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: 'PAYMENT', status: 'COMPLETED' } }),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: 'WITHDRAWAL' } }),
      this.prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: 'PENDING' } }),
    ]);
    return {
      transactionsTotal: total,
      rechargeAmount: recharges._sum.amount ?? 0,
      paymentAmount: Math.abs(payments._sum.amount ?? 0),
      withdrawalAmount: Math.abs(withdrawals._sum.amount ?? 0),
      pendingWithdrawals: pending,
    };
  }

  async getFinanceTransactions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        include: { user: { select: { id: true, firstName: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' }, skip, take: limit,
      }),
      this.prisma.transaction.count(),
    ]);
    return { page, limit, total, items };
  }

  async getLoginActivity() {
    return this.prisma.user.findMany({
      where: { lastLoginAt: { not: null } },
      select: { id: true, firstName: true, email: true, role: true, accountStatus: true, createdAt: true, lastLoginAt: true },
      orderBy: { lastLoginAt: 'desc' }, take: 100,
    });
  }

  async getPricingConfig() {
    return {
      baseFare: Number(process.env.PRICING_PICKUP_FEE ?? 3),
      pricePerKm: {
        MOTO: Number(process.env.PRICING_KM_MOTO ?? 1.0),
        ECO: Number(process.env.PRICING_KM_ECO ?? 1.2),
        CONFORT: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
        VAN: Number(process.env.PRICING_KM_VAN ?? 1.9),
      },
      pricePerMinute: Number(process.env.PRICING_MINUTE_RATE ?? 0.3),
      minimumFare: Number(process.env.PRICING_MIN_PRICE ?? 7),
      currency: 'XOF',
    };
  }

  async updatePricingConfig(body: any) {
    // En production, stocker en DB ou env. Ici on retourne la config mise à jour.
    return { ...await this.getPricingConfig(), ...body, updated: true };
  }

  async estimatePrice(params: {
    distanceKm: number;
    durationMin: number;
    vehicleType?: string;
    zone?: string;
    timeOfDay?: string;
    trafficLevel?: string;
    weatherCondition?: string;
    demandLevel?: string;
  }) {
    const {
      distanceKm, durationMin,
      vehicleType = 'ECO',
      zone = 'normal',
      timeOfDay = 'normal',
      trafficLevel = 'fluide',
      weatherCondition = 'normale',
      demandLevel = 'normale',
    } = params;

    const PRISE_EN_CHARGE = Number(process.env.PRICING_PICKUP_FEE ?? 3);
    const TARIF_KM: Record<string, number> = {
      MOTO:    Number(process.env.PRICING_KM_MOTO    ?? 1.0),
      ECO:     Number(process.env.PRICING_KM_ECO     ?? 1.2),
      CONFORT: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
      VAN:     Number(process.env.PRICING_KM_VAN     ?? 1.9),
    };
    const TARIF_MIN  = Number(process.env.PRICING_MINUTE_RATE ?? 0.30);
    const MINIMUM    = Number(process.env.PRICING_MIN_PRICE   ?? 7);

    const COEFF_ZONE:    Record<string, number> = { centre: 1.2, aeroport: 1.4, rural: 0.9, normal: 1.0 };
    const COEFF_HORAIRE: Record<string, number> = { creuse: 1.0, normal: 1.0, pointe: 1.3, nuit: 1.4 };
    const COEFF_TRAFIC:  Record<string, number> = { fluide: 1.0, modere: 1.1, dense: 1.25, bloque: 1.4 };
    const COEFF_METEO:   Record<string, number> = { normale: 1.0, pluie: 1.1, forte_pluie: 1.2, tempete: 1.4 };
    const COEFF_DEMANDE: Record<string, number> = { normale: 1.0, forte: 1.2, tres_forte: 1.5, critique: 2.0 };

    const vt = vehicleType.toUpperCase();
    const tarifKm = TARIF_KM[vt] ?? TARIF_KM['ECO'];

    const prixDistance = distanceKm * tarifKm;
    const prixTemps    = durationMin * TARIF_MIN;
    const prixBase     = PRISE_EN_CHARGE + prixDistance + prixTemps;

    const cZone    = COEFF_ZONE[zone]              ?? 1.0;
    const cHoraire = COEFF_HORAIRE[timeOfDay]      ?? 1.0;
    const cTrafic  = COEFF_TRAFIC[trafficLevel]    ?? 1.0;
    const cMeteo   = COEFF_METEO[weatherCondition] ?? 1.0;
    const cDemande = COEFF_DEMANDE[demandLevel]     ?? 1.0;

    const totalCoeff  = cZone * cHoraire * cTrafic * cMeteo * cDemande;
    const prixFinal   = Math.max(prixBase * totalCoeff, MINIMUM);
    const prixArrondi = Math.round(prixFinal * 100) / 100;

    const commissionRate = Number(process.env.PLATFORM_COMMISSION ?? 0.20);
    const partChauffeur  = Math.round(prixArrondi * (1 - commissionRate) * 100) / 100;
    const partPlateforme = Math.round(prixArrondi * commissionRate * 100)       / 100;

    return {
      estimate: prixArrondi,
      breakdown: {
        prixBase: Math.round(prixBase * 100) / 100,
        prixDistance: Math.round(prixDistance * 100) / 100,
        prixTemps: Math.round(prixTemps * 100) / 100,
        priseEnCharge: PRISE_EN_CHARGE,
        coefficients: {
          zone: cZone, horaire: cHoraire, trafic: cTrafic,
          meteo: cMeteo, demande: cDemande, total: Math.round(totalCoeff * 100) / 100,
        },
      },
      split: { chauffeur: partChauffeur, plateforme: partPlateforme },
      params: { distanceKm, durationMin, vehicleType: vt, zone, timeOfDay, trafficLevel, weatherCondition, demandLevel },
      currency: 'XOF',
    };
  }
}
