// src/rides/rides.service.ts
import {
  Injectable, BadRequestException, ForbiddenException, NotFoundException, Logger,
} from '@nestjs/common';
import { PaymentMethod, RideStatus, VehicleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../common/websocket.gateway';
import { MailService } from '../mail/mail.service';
import { IsString, IsNumber, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createHmac, randomBytes } from 'crypto';

export class CreateRideDto {
  @ApiProperty() @IsNumber() pickupLat: number;
  @ApiProperty() @IsNumber() pickupLng: number;
  @ApiProperty() @IsNumber() dropoffLat: number;
  @ApiProperty() @IsNumber() dropoffLng: number;
  @ApiPropertyOptional() @IsOptional() @IsString() pickupAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dropoffAddress?: string;
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) vehicleType: VehicleType;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() airConditioning?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wifi?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() usb?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() music?: boolean;
}

export class CreateDeliveryDto {
  @ApiProperty() @IsNumber() pickupLat: number;
  @ApiProperty() @IsNumber() pickupLng: number;
  @ApiProperty() @IsNumber() dropoffLat: number;
  @ApiProperty() @IsNumber() dropoffLng: number;
  @ApiPropertyOptional() @IsOptional() @IsString() pickupAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dropoffAddress?: string;
  @ApiProperty() @IsString() senderName: string;
  @ApiProperty() @IsString() senderPhone: string;
  @ApiProperty() @IsString() recipientName: string;
  @ApiProperty() @IsString() recipientPhone: string;
  @ApiProperty({ enum: ['SMALL', 'MEDIUM', 'LARGE'] }) parcelSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  @ApiPropertyOptional() @IsOptional() @IsString() parcelDesc?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generatePinCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: AppGateway,
    private mail: MailService,
  ) {}

  // ── Estimation dynamique du prix ────────────────────────────────────────
  estimatePrice(input: {
    distanceKm: number; durationMin: number; vehicleType?: string;
    zone?: string; horaire?: string; trafic?: string; meteo?: string; demande?: string;
  }) {
    const distanceKm = Number(input.distanceKm);
    const durationMin = Number(input.durationMin);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new BadRequestException('distanceKm invalide');
    if (!Number.isFinite(durationMin) || durationMin <= 0) throw new BadRequestException('durationMin invalide');

    const rideType = (input.vehicleType ?? 'MOTO').toUpperCase();
    const pickupFee = Number(process.env.PRICING_PICKUP_FEE ?? 3);
    const minuteRate = Number(process.env.PRICING_MINUTE_RATE ?? 0.3);
    const minPrice = Number(process.env.PRICING_MIN_PRICE ?? 7);
    const maxSurge = Number(process.env.PRICING_MAX_SURGE ?? 3);

    const perKm: Record<string, number> = {
      MOTO: Number(process.env.PRICING_KM_MOTO ?? 1.0),
      ECO: Number(process.env.PRICING_KM_ECO ?? 1.2),
      CONFORT: Number(process.env.PRICING_KM_CONFORT ?? 1.5),
      VAN: Number(process.env.PRICING_KM_VAN ?? 1.9),
      BERLINE: 1.4, SUV: 1.6, LUXE: 2.5,
    };

    const zoneC: Record<string, number> = { normal: 1, centre: 1.2, rural: 0.9, aeroport: 1.4 };
    const horaireC: Record<string, number> = { creuse: 1, normal: 1.1, pointe: 1.3, nuit: 1.4 };
    const traficC: Record<string, number> = { fluide: 1, modere: 1.1, dense: 1.25, bloque: 1.4 };
    const meteoC: Record<string, number> = { normale: 1, pluie: 1.1, forte_pluie: 1.2, tempete: 1.4 };
    const demandeC: Record<string, number> = { normale: 1, forte: 1.2, tres_forte: 1.5, critique: 2 };

    const kmRate = perKm[rideType] ?? perKm.MOTO;
    const base = pickupFee + distanceKm * kmRate + durationMin * minuteRate;
    const surgeRaw =
      (zoneC[input.zone?.toLowerCase() ?? 'normal'] ?? 1) *
      (horaireC[input.horaire?.toLowerCase() ?? 'normal'] ?? 1) *
      (traficC[input.trafic?.toLowerCase() ?? 'fluide'] ?? 1) *
      (meteoC[input.meteo?.toLowerCase() ?? 'normale'] ?? 1) *
      (demandeC[input.demande?.toLowerCase() ?? 'normale'] ?? 1);
    const surgeApplied = Math.min(surgeRaw, maxSurge);
    const estimatedPrice = Math.max(Number((base * surgeApplied).toFixed(2)), minPrice);

    return { distanceKm, durationMin, vehicleType: rideType, estimatedPrice, currency: 'XOF', breakdown: { base: Number(base.toFixed(2)), surgeApplied: Number(surgeApplied.toFixed(3)) } };
  }

  // ── Créer une course VTC ─────────────────────────────────────────────────
  async create(passengerId: string, dto: CreateRideDto) {
    const distance = haversine(dto.pickupLat, dto.pickupLng, dto.dropoffLat, dto.dropoffLng);
    const estimate = this.estimatePrice({ distanceKm: distance, durationMin: Math.ceil((distance / 30) * 60), vehicleType: dto.vehicleType });
    const pinCode = generatePinCode();

    const ride = await this.prisma.ride.create({
      data: {
        passengerId, serviceType: 'VTC',
        pickupLat: dto.pickupLat, pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat, dropoffLng: dto.dropoffLng,
        pickupAddress: dto.pickupAddress, dropoffAddress: dto.dropoffAddress,
        vehicleType: dto.vehicleType, paymentMethod: dto.paymentMethod,
        estimatedPrice: dto.price ?? estimate.estimatedPrice,
        distanceKm: Math.round(distance * 10) / 10,
        durationMin: Math.ceil((distance / 30) * 60),
        pinCode, status: 'REQUESTED',
        airConditioning: dto.airConditioning ?? false,
        wifi: dto.wifi ?? false, usb: dto.usb ?? false, music: dto.music ?? false,
      },
      include: { passenger: { select: { id: true, firstName: true, phone: true, email: true } } },
    });

    this.gateway.notifyDrivers(ride);
    this.mail.sendRideValidationEmail(ride.passenger?.email, { rideId: ride.id, status: ride.status, price: ride.estimatedPrice, vehicleType: ride.vehicleType }).catch(() => {});

    this.logger.log(`Course créée: ${ride.id}`);
    return ride;
  }

  // ── Créer une livraison ──────────────────────────────────────────────────
  async createDelivery(passengerId: string, dto: CreateDeliveryDto) {
    const distance = haversine(dto.pickupLat, dto.pickupLng, dto.dropoffLat, dto.dropoffLng);
    const estimate = this.estimatePrice({ distanceKm: distance, durationMin: Math.ceil((distance / 30) * 60), vehicleType: 'MOTO' });
    const pinCode = generatePinCode();

    const ride = await this.prisma.ride.create({
      data: {
        passengerId, serviceType: 'DELIVERY',
        pickupLat: dto.pickupLat, pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat, dropoffLng: dto.dropoffLng,
        pickupAddress: dto.pickupAddress, dropoffAddress: dto.dropoffAddress,
        vehicleType: 'MOTO', paymentMethod: dto.paymentMethod ?? 'CASH',
        estimatedPrice: estimate.estimatedPrice,
        distanceKm: Math.round(distance * 10) / 10,
        durationMin: Math.ceil((distance / 30) * 60),
        pinCode, status: 'REQUESTED',
        senderName: dto.senderName, senderPhone: dto.senderPhone,
        recipientName: dto.recipientName, recipientPhone: dto.recipientPhone,
        parcelSize: dto.parcelSize as any, parcelDesc: dto.parcelDesc, deliveryNote: dto.deliveryNote,
      },
      include: { passenger: { select: { id: true, firstName: true, phone: true, email: true } } },
    });

    this.gateway.notifyDrivers({ ...ride, isDelivery: true });
    this.logger.log(`Livraison créée: ${ride.id}`);
    return ride;
  }

  // ── Détail course ───────────────────────────────────────────────────────
  async findById(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        passenger: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        driver: { select: { id: true, firstName: true, lastName: true, phone: true, driverProfile: { select: { vehicleMake: true, vehicleModel: true, vehicleColor: true, licensePlate: true, rating: true } } } },
        payment: true,
      },
    });
    if (!ride) throw new NotFoundException('Course introuvable');
    return ride;
  }

  // ── Accepter (REST fallback) ─────────────────────────────────────────────
  async acceptRide(rideId: string, userId: string) {
    const driver = await this.prisma.user.findUnique({ where: { id: userId }, include: { driverProfile: true } });
    if (!driver?.driverProfile?.adminApproved) throw new ForbiddenException('Compte chauffeur non approuvé');
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== 'REQUESTED') throw new BadRequestException('Course non disponible');

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: { driverId: userId, status: 'ACCEPTED', acceptedAt: new Date() },
      include: { passenger: { select: { id: true, firstName: true, phone: true } } },
    });

    this.gateway.notifyPassenger(ride.passengerId, 'ride_accepted', updated);
    return updated;
  }

  // ── Statut ───────────────────────────────────────────────────────────────
  async updateStatus(rideId: string, userId: string, status: RideStatus, cancelReason?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');

    const now = new Date();
    const data: any = { status };
    if (status === 'ARRIVED') data.arrivedAt = now;
    if (status === 'IN_PROGRESS') data.startedAt = now;
    if (status === 'COMPLETED') { data.completedAt = now; data.finalPrice = ride.finalPrice ?? ride.estimatedPrice; }
    if (status === 'CANCELLED') { data.cancelledAt = now; if (cancelReason) data.cancelReason = cancelReason; }

    const updated = await this.prisma.ride.update({ where: { id: rideId }, data });

    if (status === 'COMPLETED' && ride.driverId) {
      await this.prisma.driverProfile.update({
        where: { userId: ride.driverId },
        data: { totalRides: { increment: 1 }, totalEarnings: { increment: updated.finalPrice ?? 0 } },
      }).catch(() => {});
    }

    this.gateway.notifyPassenger(ride.passengerId, `ride_${status.toLowerCase()}`, updated);
    return updated;
  }

  // ── Vérifier PIN ─────────────────────────────────────────────────────────
  async verifyPin(rideId: string, pin: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, select: { pinCode: true, status: true } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (ride.status !== 'ARRIVED') throw new BadRequestException('Le chauffeur doit signaler son arrivée d\'abord');
    if (ride.pinCode !== pin) throw new BadRequestException('Code PIN incorrect');
    return this.prisma.ride.update({ where: { id: rideId }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
  }

  // ── Courses disponibles ──────────────────────────────────────────────────
  async getAvailableRides(driverLat: number, driverLng: number, vehicleType?: string) {
    const where: any = { status: 'REQUESTED', driverId: null };
    if (vehicleType) where.vehicleType = vehicleType;

    const rides = await this.prisma.ride.findMany({
      where,
      include: { passenger: { select: { firstName: true, lastName: true } } },
      orderBy: { requestedAt: 'asc' },
    });

    return rides
      .map((r) => ({
        ...r,
        distanceToPickup: Math.round(haversine(driverLat, driverLng, r.pickupLat, r.pickupLng) * 10) / 10,
      }))
      .sort((a, b) => a.distanceToPickup - b.distanceToPickup)
      .slice(0, 10);
  }

  // ── Historique ───────────────────────────────────────────────────────────
  async getHistory(userId: string, role: string) {
    const where = role === 'DRIVER' ? { driverId: userId } : { passengerId: userId };
    return this.prisma.ride.findMany({
      where, orderBy: { requestedAt: 'desc' }, take: 50,
      select: {
        id: true, status: true, serviceType: true, vehicleType: true,
        pickupAddress: true, dropoffAddress: true,
        estimatedPrice: true, finalPrice: true,
        paymentMethod: true, isPaid: true,
        requestedAt: true, completedAt: true,
        driverRating: true, passengerRating: true,
      },
    });
  }

  // ── Courses actives passager ─────────────────────────────────────────────
  async getUpcomingRides(passengerId: string) {
    return this.prisma.ride.findMany({
      where: {
        passengerId,
        status: { in: ['REQUESTED', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as any[] },
      },
      orderBy: { requestedAt: 'desc' },
      include: { driver: { select: { id: true, firstName: true, phone: true, driverProfile: { select: { vehicleMake: true, vehicleModel: true, licensePlate: true } } } } },
    });
  }

  // ── Stats chauffeur ──────────────────────────────────────────────────────
  async getDriverStats(driverId: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [day, week, month, all] = await Promise.all([
      this.prisma.ride.findMany({ where: { driverId, status: 'COMPLETED', completedAt: { gte: startOfDay } } }),
      this.prisma.ride.findMany({ where: { driverId, status: 'COMPLETED', completedAt: { gte: startOfWeek } } }),
      this.prisma.ride.findMany({ where: { driverId, status: 'COMPLETED', completedAt: { gte: startOfMonth } } }),
      this.prisma.ride.findMany({ where: { driverId, status: 'COMPLETED' } }),
    ]);

    const sum = (rides: any[]) => rides.reduce((a, r) => a + (r.finalPrice ?? r.estimatedPrice ?? 0), 0);

    return {
      todayEarnings: sum(day), todayRides: day.length,
      weekEarnings: sum(week), weekRides: week.length,
      monthEarnings: sum(month), monthRides: month.length,
      totalEarnings: sum(all), totalRides: all.length,
    };
  }

  // ── Annuler ──────────────────────────────────────────────────────────────
  async cancelRide(rideId: string, userId: string, role: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Course introuvable');
    if (!['REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(ride.status)) {
      throw new BadRequestException('Cette course ne peut plus être annulée');
    }
    if (role === 'PASSENGER' && ride.passengerId !== userId) throw new ForbiddenException('Non autorisé');
    if (role === 'DRIVER' && ride.driverId !== userId) throw new ForbiddenException('Non autorisé');

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    this.gateway.notifyPassenger(ride.passengerId, 'ride_cancelled', { rideId, cancelledBy: role });
    if (ride.driverId) this.gateway.notifyPassenger(ride.driverId, 'ride_cancelled', { rideId, cancelledBy: role });
    return updated;
  }

  // ── Notation ─────────────────────────────────────────────────────────────
  async rateRide(rideId: string, userId: string, role: string, rating: number, comment?: string) {
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new BadRequestException('Note entre 1 et 5');
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== 'COMPLETED') throw new BadRequestException('Course non terminée');

    if (role === 'PASSENGER') {
      if (ride.passengerId !== userId) throw new ForbiddenException('Non autorisé');
      return this.prisma.ride.update({ where: { id: rideId }, data: { driverRating: rating, passengerComment: comment } });
    }
    if (ride.driverId !== userId) throw new ForbiddenException('Non autorisé');
    return this.prisma.ride.update({ where: { id: rideId }, data: { passengerRating: rating, driverComment: comment } });
  }

  // ── Partage de trajet ────────────────────────────────────────────────────
  async generateShareToken(rideId: string, passengerId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.passengerId !== passengerId) throw new ForbiddenException('Course introuvable ou non autorisée');
    const nonce = randomBytes(6).toString('hex');
    const payload = `${rideId}.${Date.now()}.${nonce}`;
    const secret = process.env.RIDE_SHARE_SECRET || process.env.JWT_ACCESS_SECRET || 'share-secret';
    const signature = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
    const token = Buffer.from(`${payload}.${signature}`).toString('base64url');
    return { shareToken: token, shareUrl: `${process.env.FRONTEND_URL ?? 'https://koogwe.com'}/track/${token}` };
  }

  async getRideByShareToken(token: string) {
    let decoded: string;
    try { decoded = Buffer.from(token, 'base64url').toString('utf8'); }
    catch { throw new BadRequestException('Lien invalide'); }

    const parts = decoded.split('.');
    if (parts.length !== 4) throw new BadRequestException('Lien invalide');
    const [rideId, timestamp, nonce, signature] = parts;
    const secret = process.env.RIDE_SHARE_SECRET || process.env.JWT_ACCESS_SECRET || 'share-secret';
    const expected = createHmac('sha256', secret).update(`${rideId}.${timestamp}.${nonce}`).digest('hex').slice(0, 16);
    if (signature !== expected) throw new BadRequestException('Lien invalide');

    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { passenger: { select: { firstName: true } }, driver: { select: { firstName: true } } },
    });
    if (!ride) throw new NotFoundException('Course introuvable');
    return { id: ride.id, status: ride.status, pickupLat: ride.pickupLat, pickupLng: ride.pickupLng, dropoffLat: ride.dropoffLat, dropoffLng: ride.dropoffLng, pickupAddress: ride.pickupAddress, dropoffAddress: ride.dropoffAddress };
  }

  // ── Bouton panique ────────────────────────────────────────────────────────
  async triggerPanic(userId: string, rideId: string | null, lat: number, lng: number) {
    await this.prisma.notification.create({
      data: { userId, type: 'PANIC', title: '🚨 Bouton panique activé', body: `Alerte ride=${rideId ?? 'N/A'} pos=${lat},${lng}` },
    });
    this.gateway.notifyRideRoom(rideId ?? 'global', 'panic_alert', { userId, rideId, lat, lng });
    return { success: true, message: 'Alerte envoyée' };
  }

  // ── Cours planifiée ───────────────────────────────────────────────────────
  async createScheduledRide(passengerId: string, dto: any) {
    const scheduledAt = new Date(dto.scheduledAt);
    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      throw new BadRequestException('La date doit être dans le futur');
    }
    const ride = await this.create(passengerId, dto);
    await this.prisma.ride.update({ where: { id: ride.id }, data: { scheduledAt } });
    return { ...ride, isScheduled: true, scheduledAt };
  }
}
