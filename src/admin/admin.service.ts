// src/admin/admin.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  // ─── Dashboard Stats ───────────────────────────────────────────────────────
  async getDashboardStats() {
    const [
      totalPassengers,
      totalDrivers,
      pendingDrivers,
      totalRides,
      activeRides,
      completedRides,
      cancelledRides,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'PASSENGER' } }),
      this.prisma.driver.count(),
      this.prisma.driver.count({ where: { status: 'PENDING' } }),
      this.prisma.ride.count(),
      this.prisma.ride.count({ where: { status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } }),
      this.prisma.ride.count({ where: { status: 'COMPLETED' } }),
      this.prisma.ride.count({ where: { status: 'CANCELLED' } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED' },
      }),
    ]);

    return {
      passengers: { total: totalPassengers },
      drivers: { total: totalDrivers, pending: pendingDrivers },
      rides: {
        total: totalRides,
        active: activeRides,
        completed: completedRides,
        cancelled: cancelledRides,
      },
      revenue: {
        total: totalRevenue._sum.finalPrice ?? 0,
      },
    };
  }

  // ─── Courses récentes ──────────────────────────────────────────────────────
  async getRecentRides(limit = 10) {
    return this.prisma.ride.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        driver: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          },
        },
      },
    });
  }

  // ─── Documents en attente ──────────────────────────────────────────────────
  async getPendingDocuments() {
    return this.prisma.driverDocument.findMany({
      where: { isVerified: false },
      orderBy: { createdAt: 'desc' },
      include: {
        driver: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
  }

  // ─── Chauffeurs ────────────────────────────────────────────────────────────
  async getAllDrivers() {
    return this.prisma.driver.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, isActive: true, createdAt: true } },
        documents: true,
      },
    });
  }

  async getDriver(id: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: {
        user: true,
        documents: true,
        rides: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            passenger: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!driver) throw new NotFoundException('Chauffeur introuvable');
    return driver;
  }

  async suspendDriver(id: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id }, include: { user: true } });
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    await this.prisma.driver.update({ where: { id }, data: { status: 'SUSPENDED' } });
    await this.prisma.user.update({ where: { id: driver.userId }, data: { isActive: false } });

    return { message: 'Chauffeur suspendu' };
  }

  async activateDriver(id: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id }, include: { user: true } });
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    await this.prisma.driver.update({ where: { id }, data: { status: 'APPROVED' } });
    await this.prisma.user.update({ where: { id: driver.userId }, data: { isActive: true } });

    return { message: 'Chauffeur activé' };
  }

  async approveOrRejectDriver(id: string, approved: boolean, adminNotes?: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!driver) throw new NotFoundException('Chauffeur introuvable');

    const newStatus = approved ? 'APPROVED' : 'REJECTED';
    await this.prisma.driver.update({ where: { id }, data: { status: newStatus } });

    // Envoyer un email de notification
    if (approved) {
      await this.mail.sendDriverApproved(
        driver.user.email,
        driver.user.firstName ?? 'Chauffeur',
      );
    }

    return { message: approved ? 'Dossier approuvé' : 'Dossier rejeté', adminNotes };
  }

  // ─── Documents ─────────────────────────────────────────────────────────────
  async getAllDocuments(status?: string) {
    const where: any = {};
    if (status && status !== 'ALL') {
      where.isVerified = status === 'VERIFIED';
    }

    return this.prisma.driverDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        driver: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
  }

  async approveDocument(id: string) {
    const doc = await this.prisma.driverDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document introuvable');

    await this.prisma.driverDocument.update({ where: { id }, data: { isVerified: true } });
    return { message: 'Document approuvé' };
  }

  async rejectDocument(id: string, reason?: string) {
    const doc = await this.prisma.driverDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document introuvable');

    // On supprime le document rejeté pour que le chauffeur puisse en soumettre un nouveau
    await this.prisma.driverDocument.delete({ where: { id } });
    return { message: 'Document rejeté', reason };
  }

  // ─── Passagers ─────────────────────────────────────────────────────────────
  async getAllPassengers() {
    return this.prisma.user.findMany({
      where: { role: 'PASSENGER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { passengerRides: true } },
      },
    });
  }

  async suspendPassenger(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { message: 'Passager suspendu' };
  }

  async activatePassenger(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: true } });
    return { message: 'Passager activé' };
  }

  // ─── Courses ───────────────────────────────────────────────────────────────
  async getAllRides(limit = 50) {
    return this.prisma.ride.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { firstName: true, lastName: true, email: true } },
        driver: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        payment: true,
      },
    });
  }

  async getActiveRides() {
    return this.prisma.ride.findMany({
      where: {
        status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: { select: { firstName: true, lastName: true } },
        driver: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
  }

  // ─── Finances ──────────────────────────────────────────────────────────────
  async getFinanceStats() {
    const [totalRevenue, todayRevenue, weekRevenue, monthRevenue] = await Promise.all([
      this.prisma.ride.aggregate({ _sum: { finalPrice: true }, where: { status: 'COMPLETED' } }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(new Date().setHours(0,0,0,0)) } },
      }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        where: { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return {
      total: totalRevenue._sum.finalPrice ?? 0,
      today: todayRevenue._sum.finalPrice ?? 0,
      week: weekRevenue._sum.finalPrice ?? 0,
      month: monthRevenue._sum.finalPrice ?? 0,
    };
  }

  async getFinanceChart(period: 'daily' | 'weekly' | 'monthly' = 'weekly') {
    // Retourner les 7 derniers jours groupés par jour
    const days = period === 'daily' ? 7 : period === 'weekly' ? 4 : 12;
    const data = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const result = await this.prisma.ride.aggregate({
        _sum: { finalPrice: true },
        _count: { id: true },
        where: { status: 'COMPLETED', completedAt: { gte: start, lte: end } },
      });

      data.push({
        date: start.toISOString().split('T')[0],
        revenue: result._sum.finalPrice ?? 0,
        rides: result._count.id ?? 0,
      });
    }

    return data;
  }

  async getFinanceTransactions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.prisma.ride.findMany({
        skip,
        take: limit,
        where: { status: 'COMPLETED', finalPrice: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          finalPrice: true,
          paymentMethod: true,
          completedAt: true,
          passenger: { select: { firstName: true, lastName: true } },
          driver: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.ride.count({ where: { status: 'COMPLETED', finalPrice: { not: null } } }),
    ]);

    return { transactions, total, page, limit };
  }
}
