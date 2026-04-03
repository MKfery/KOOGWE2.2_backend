// src/common/websocket.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
  ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RideStatus, PaymentMethod } from '@prisma/client';

interface AuthSocket extends Socket {
  userId?: string;
  userRole?: string;
  driverProfileId?: string;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/' })
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AppGateway.name);
  private socketUserMap = new Map<string, string>(); // socketId → userId

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  // ─── Connexion ────────────────────────────────────────────────────────────
  async handleConnection(client: AuthSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }

      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      }) as any;

      client.userId = payload.sub;
      client.userRole = payload.role;
      this.socketUserMap.set(client.id, payload.sub);
      client.join(`user:${payload.sub}`);

      if (payload.role === 'DRIVER') {
        const dp = await this.prisma.driverProfile.findUnique({
          where: { userId: payload.sub },
          select: { id: true },
        });
        if (dp) {
          client.driverProfileId = dp.id;
          client.join(`driver:${dp.id}`);
        }
      }

      this.logger.log(`🔌 Connecté: ${payload.sub} (${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  // ─── Déconnexion ──────────────────────────────────────────────────────────
  handleDisconnect(client: AuthSocket) {
    this.socketUserMap.delete(client.id);
    if (client.userId) {
      // Passer le chauffeur hors ligne automatiquement
      if (client.userRole === 'DRIVER') {
        this.prisma.driverProfile.updateMany({
          where: { userId: client.userId },
          data: { isOnline: false },
        }).catch(() => {});
      }
    }
    this.logger.log(`🔌 Déconnecté: ${client.userId ?? client.id}`);
  }

  // ─── Rejoindre room course ─────────────────────────────────────────────────
  @SubscribeMessage('join_ride')
  handleJoinRide(@ConnectedSocket() c: AuthSocket, @MessageBody() d: { rideId: string }) {
    c.join(`ride:${d.rideId}`);
  }

  @SubscribeMessage('leave_ride')
  handleLeaveRide(@ConnectedSocket() c: AuthSocket, @MessageBody() d: { rideId: string }) {
    c.leave(`ride:${d.rideId}`);
  }

  // ─── Chauffeur en ligne / hors ligne ──────────────────────────────────────
  @SubscribeMessage('driver_online')
  async handleDriverOnline(@ConnectedSocket() client: AuthSocket) {
    const userId = client.userId;
    if (!userId) return;

    const dp = await this.prisma.driverProfile.findUnique({ where: { userId } });
    const canGoOnline = dp?.faceVerified && dp?.documentsUploaded && dp?.adminApproved
      && dp?.vehicleMake && dp?.vehicleModel && dp?.licensePlate;

    if (!canGoOnline) {
      client.emit('driver_restricted', { reason: 'Compte incomplet: vérification, documents, véhicule et validation admin requis' });
      return;
    }

    await this.prisma.driverProfile.update({ where: { userId }, data: { isOnline: true } });
    client.join('drivers_online');
    client.emit('driver_online_confirmed', { status: 'ONLINE' });
    this.logger.log(`🟢 Chauffeur en ligne: ${userId}`);
  }

  @SubscribeMessage('driver_offline')
  async handleDriverOffline(@ConnectedSocket() client: AuthSocket) {
    if (!client.userId) return;
    client.leave('drivers_online');
    await this.prisma.driverProfile.update({
      where: { userId: client.userId },
      data: { isOnline: false },
    }).catch(() => {});
    client.emit('driver_offline_confirmed', { status: 'OFFLINE' });
  }

  // ─── GPS position ─────────────────────────────────────────────────────────
  @SubscribeMessage('driver:location')
  async handleDriverLocation(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { lat: number; lng: number; heading?: number; rideId?: string },
  ) {
    if (!client.userId) return;

    await this.prisma.driverProfile.update({
      where: { userId: client.userId },
      data: {
        currentLat: data.lat, currentLng: data.lng,
        heading: data.heading, lastLocationAt: new Date(),
      },
    }).catch(() => {});

    if (data.rideId) {
      this.server.to(`ride:${data.rideId}`).emit('driver:location', {
        lat: data.lat, lng: data.lng, heading: data.heading,
      });
    }
  }

  // ─── Accepter une course ──────────────────────────────────────────────────
  // ✅ FIX V1: vérifie que le vehicleType du chauffeur correspond à la course
  @SubscribeMessage('accept_ride')
  async handleAcceptRide(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { rideId: string },
  ) {
    try {
      const userId = client.userId;
      if (!userId) return;

      const [driver, ride] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          include: { driverProfile: true },
        }),
        this.prisma.ride.findUnique({ where: { id: data.rideId } }),
      ]);

      if (!driver || driver.role !== 'DRIVER' || !driver.driverProfile) {
        client.emit('accept_ride_error', { message: 'Compte chauffeur introuvable' });
        return;
      }

      const dp = driver.driverProfile;
      if (!dp.faceVerified || !dp.documentsUploaded || !dp.adminApproved || !dp.vehicleMake || !dp.vehicleModel || !dp.licensePlate) {
        client.emit('driver_restricted', { reason: 'Compte chauffeur incomplet' });
        return;
      }

      if (!ride || ride.status !== RideStatus.REQUESTED) {
        client.emit('accept_ride_error', { message: 'Course non disponible' });
        return;
      }

      // ✅ FIX V1 CRITIQUE: vérifier compatibilité vehicleType chauffeur ↔ course
      const compatibleTypes: Record<string, string[]> = {
        MOTO:    ['MOTO'],
        ECO:     ['ECO', 'BERLINE'],
        CONFORT: ['CONFORT', 'BERLINE', 'SUV'],
        BERLINE: ['ECO', 'CONFORT', 'BERLINE'],
        VAN:     ['VAN'],
        SUV:     ['SUV', 'CONFORT'],
        LUXE:    ['LUXE'],
      };
      const driverVehicle = dp.vehicleType as string;
      const rideVehicle = ride.vehicleType as string;
      const compatible = compatibleTypes[driverVehicle] ?? [driverVehicle];
      if (!compatible.includes(rideVehicle)) {
        client.emit('accept_ride_error', {
          message: `Votre véhicule (${driverVehicle}) n'est pas compatible avec cette course (${rideVehicle})`,
        });
        return;
      }

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { status: RideStatus.ACCEPTED, driverId: userId, acceptedAt: new Date() },
      });
      await this.prisma.driverProfile.update({
        where: { userId },
        data: { isOnline: false }, // ON_RIDE
      }).catch(() => {});

      const payload = {
        status: 'ACCEPTED', driverId: userId,
        driverName: driver.firstName,
        driverPhone: driver.phone,
        vehicleInfo: `${dp.vehicleMake} ${dp.vehicleModel} • ${dp.vehicleColor ?? ''}`,
        licensePlate: dp.licensePlate,
        driverRating: dp.rating,
      };

      this.server.to(`ride:${data.rideId}`).emit(`ride_status_${data.rideId}`, payload);
      this.server.to(`user:${ride.passengerId}`).emit('ride_accepted', payload);
      client.emit('accept_ride_confirmed', { rideId: data.rideId });
      this.logger.log(`✅ Course ${data.rideId} acceptée par ${userId}`);
    } catch (e) {
      this.logger.error('accept_ride error:', e);
      client.emit('accept_ride_error', { message: "Erreur lors de l'acceptation" });
    }
  }

  // ─── Chauffeur arrivé ──────────────────────────────────────────────────────
  @SubscribeMessage('driver_arrived')
  async handleDriverArrived(@ConnectedSocket() client: AuthSocket, @MessageBody() data: { rideId: string }) {
    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (ride?.driverId && ride.driverId !== client.userId) return;

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { status: RideStatus.ARRIVED, arrivedAt: new Date() },
      });
      const payload = { status: 'ARRIVED', rideId: data.rideId };
      this.server.to(`ride:${data.rideId}`).emit(`ride_status_${data.rideId}`, payload);
      if (ride?.passengerId) {
        this.server.to(`user:${ride.passengerId}`).emit('driver_arrived', payload);
      }
    } catch (e) { this.logger.error('driver_arrived error:', e); }
  }

  // ─── Démarrer la course ────────────────────────────────────────────────────
  @SubscribeMessage('start_trip')
  async handleStartTrip(@ConnectedSocket() client: AuthSocket, @MessageBody() data: { rideId: string }) {
    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (ride?.driverId && ride.driverId !== client.userId) return;

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { status: RideStatus.IN_PROGRESS, startedAt: new Date() },
      });
      const payload = { status: 'IN_PROGRESS', rideId: data.rideId };
      this.server.to(`ride:${data.rideId}`).emit(`ride_status_${data.rideId}`, payload);
      if (ride?.passengerId) {
        this.server.to(`user:${ride.passengerId}`).emit('ride_started', payload);
      }
    } catch (e) { this.logger.error('start_trip error:', e); }
  }

  // ─── Terminer la course ────────────────────────────────────────────────────
  // ✅ FIX V1: prix ignoré côté client (sécurité), paiement wallet complet
  @SubscribeMessage('finish_trip')
  async handleFinishTrip(@ConnectedSocket() client: AuthSocket, @MessageBody() data: { rideId: string }) {
    try {
      const userId = client.userId;
      const ride = await this.prisma.ride.findUnique({
        where: { id: data.rideId },
        include: {
          passenger: { select: { id: true, firstName: true } },
          driver: { select: { id: true, firstName: true } },
        },
      });
      if (!ride) return;
      if (ride.driverId && ride.driverId !== userId) return; // sécurité

      // ✅ FIX: prix toujours depuis la DB, jamais depuis le client
      const finalPrice = ride.finalPrice ?? ride.estimatedPrice;

      const updatedRide = await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { status: RideStatus.COMPLETED, completedAt: new Date(), finalPrice },
      });

      const completedPayload = {
        status: 'COMPLETED', rideId: data.rideId,
        finalPrice, driver: ride.driver, passenger: ride.passenger,
      };

      this.server.to(`ride:${data.rideId}`).emit(`ride_status_${data.rideId}`, completedPayload);
      this.server.to(`user:${ride.passengerId}`).emit('ride_completed', completedPayload);
      if (ride.driverId) {
        this.server.to(`user:${ride.driverId}`).emit('trip_finished_driver', {
          rideId: data.rideId, finalPrice, passengerName: ride.passenger?.firstName,
        });
        await this.prisma.driverProfile.update({
          where: { userId: ride.driverId },
          data: { totalRides: { increment: 1 }, totalEarnings: { increment: finalPrice }, isOnline: true },
        }).catch(() => {});
      }

      // ✅ FIX V1: paiement wallet automatique complet avec transactions
      if (updatedRide.paymentMethod === PaymentMethod.WALLET && !updatedRide.isPaid) {
        try {
          const wallet = await this.prisma.wallet.findUnique({ where: { userId: ride.passengerId } });
          if (wallet && wallet.balance >= finalPrice) {
            await this.prisma.$transaction([
              this.prisma.wallet.update({ where: { userId: ride.passengerId }, data: { balance: { decrement: finalPrice } } }),
              this.prisma.wallet.upsert({
                where: { userId: ride.driverId! },
                create: { userId: ride.driverId!, balance: finalPrice * 0.8 },
                update: { balance: { increment: finalPrice * 0.8 } },
              }),
              this.prisma.ride.update({ where: { id: data.rideId }, data: { isPaid: true } }),
              this.prisma.transaction.create({
                data: { userId: ride.passengerId, type: 'PAYMENT', amount: finalPrice, status: 'COMPLETED', rideId: data.rideId, paymentMethod: 'WALLET' },
              }),
            ]);
            this.server.to(`user:${ride.passengerId}`).emit('payment_confirmed', { rideId: data.rideId, amount: finalPrice, method: 'WALLET' });
          } else {
            this.server.to(`user:${ride.passengerId}`).emit('payment_failed', { rideId: data.rideId, reason: 'Solde insuffisant' });
          }
        } catch (payErr) { this.logger.error('Erreur paiement wallet:', payErr); }
      }

      this.logger.log(`✅ Course ${data.rideId} terminée`);
    } catch (e) { this.logger.error('finish_trip error:', e); }
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  @SubscribeMessage('chat:message')
  async handleChat(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { rideId: string; content: string },
  ) {
    if (!client.userId) return;
    const message = await this.prisma.message.create({
      data: { rideId: data.rideId, senderId: client.userId, content: data.content, type: 'TEXT' },
      include: { sender: { select: { id: true, firstName: true, avatarUrl: true } } },
    });
    this.server.to(`ride:${data.rideId}`).emit('chat:message', message);
  }

  // ─── Méthodes utilitaires pour émettre depuis les services ────────────────
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
  notifyPassenger(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
  notifyDrivers(rideData: any) {
    this.server.to('drivers_online').emit('new_ride', rideData);
  }
  notifyRideRoom(rideId: string, event: string, data: any) {
    this.server.to(`ride:${rideId}`).emit(event, data);
  }
}
