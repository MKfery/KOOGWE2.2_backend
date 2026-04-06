// src/common/websocket.gateway.ts
// ✅ VERSION PRODUCTION — Authentification JWT sur TOUS les handlers WebSocket
//    Correction critique : ride:accept / ride:status ne peuvent plus être
//    usurpés par un client non authentifié.

import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, MessageBody, ConnectedSocket,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

// ─── Helper : extraire et vérifier le JWT du handshake ──────────────────────
function extractUserId(client: Socket, jwtService: JwtService): string | null {
  try {
    const token =
      client.handshake.auth?.token ||
      (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
    if (!token) return null;
    const payload = jwtService.verify(token, {
      secret: process.env.JWT_ACCESS_SECRET,
    }) as { sub: string };
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, cb: Function) => {
      // Apps mobiles Flutter : pas d'origin → autorisé
      if (!origin) return cb(null, true);
      const allowed = (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
        .concat([
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:8080',
        ]);
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error(`CORS WebSocket bloqué: ${origin}`));
    },
    credentials: true,
  },
  namespace: '/',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AppGateway.name);

  @WebSocketServer() server: Server;

  // userId → socketId (pour cibler un client spécifique)
  private connectedUsers = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ─── Connexion ─────────────────────────────────────────────────────────────
  handleConnection(client: Socket) {
    const userId = extractUserId(client, this.jwtService);
    if (!userId) {
      this.logger.warn(`Connexion refusée — token absent ou invalide (${client.id})`);
      client.disconnect(true);
      return;
    }
    // Stocker l'userId sur le socket pour ne plus avoir à re-décoder
    (client as any).userId = userId;
    this.connectedUsers.set(userId, client.id);
    this.logger.log(`✅ Connecté : userId=${userId} | socket=${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) this.connectedUsers.delete(userId);
    this.logger.log(`❌ Déconnecté : socket=${client.id}`);
  }

  // ─── CHAUFFEUR : mise à jour GPS ──────────────────────────────────────────
  @SubscribeMessage('driver:location')
  async handleDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; heading?: number; rideId?: string },
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    // Persist en base (fallback si WS coupe)
    await this.prisma.driverProfile
      .update({
        where: { userId },
        data: {
          currentLat: data.lat,
          currentLng: data.lng,
          heading: data.heading ?? null,
          lastLocationAt: new Date(),
        },
      })
      .catch(() => {}); // Profil peut ne pas exister pendant l'inscription

    // Broadcast uniquement à la room de la course (passager concerné)
    if (data.rideId) {
      this.server.to(`ride:${data.rideId}`).emit('driver:location', {
        driverId: userId,
        lat: data.lat,
        lng: data.lng,
        heading: data.heading ?? null,
      });
    }
  }

  // ─── CHAUFFEUR : disponibilité ─────────────────────────────────────────────
  @SubscribeMessage('driver:availability')
  async handleAvailability(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { availability: 'ONLINE' | 'OFFLINE' },
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    await this.prisma.driverProfile
      .update({
        where: { userId },
        data: { isOnline: data.availability === 'ONLINE' },
      })
      .catch(() => {});

    this.logger.log(`Chauffeur ${userId} → ${data.availability}`);
  }

  // ─── PASSAGER / CHAUFFEUR : rejoindre la room d'une course ────────────────
  @SubscribeMessage('ride:join')
  handleJoinRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId) return;

    client.join(`ride:${data.rideId}`);
    this.logger.log(`userId=${userId} a rejoint ride:${data.rideId}`);
  }

  // ─── CHAUFFEUR : accepter une course (via WebSocket) ──────────────────────
  // ✅ FIX CRITIQUE : driverId est TOUJOURS issu du JWT, jamais du payload client
  @SubscribeMessage('ride:accept')
  async handleRideAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ) {
    const driverId = (client as any).userId; // ← JWT, non falsifiable
    if (!driverId || !data.rideId) return;

    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (!ride || ride.status !== 'REQUESTED') return;

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { driverId, status: 'ACCEPTED', acceptedAt: new Date() },
      });

      // Récupérer les infos chauffeur pour le passager
      const driver = await this.prisma.user.findUnique({
        where: { id: driverId },
        select: {
          firstName: true, lastName: true, phone: true, avatarUrl: true,
          driverProfile: {
            select: {
              licensePlate: true, vehicleMake: true, vehicleModel: true,
              vehicleColor: true, rating: true,
            },
          },
        },
      });

      this.server.to(`ride:${data.rideId}`).emit('ride:accepted', {
        rideId: data.rideId,
        driverId,
        status: 'ACCEPTED',
        driver: {
          name: `${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim(),
          phone: driver?.phone,
          avatarUrl: driver?.avatarUrl,
          plate: driver?.driverProfile?.licensePlate,
          vehicle: `${driver?.driverProfile?.vehicleColor ?? ''} ${driver?.driverProfile?.vehicleMake ?? ''} ${driver?.driverProfile?.vehicleModel ?? ''}`.trim(),
          rating: driver?.driverProfile?.rating,
        },
      });
    } catch (e) {
      this.logger.error(`ride:accept error: ${e}`);
    }
  }

  // ─── CHAUFFEUR / PASSAGER : mise à jour statut course ─────────────────────
  // ✅ FIX CRITIQUE : vérification que l'émetteur fait bien partie de la course
  @SubscribeMessage('ride:status')
  async handleRideStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string; status: string; cancelReason?: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId) return;

    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (!ride) return;

      // Seuls le chauffeur et le passager de la course peuvent changer le statut
      if (ride.passengerId !== userId && ride.driverId !== userId) {
        this.logger.warn(`⛔ userId=${userId} a tenté de modifier ride:${data.rideId} sans autorisation`);
        return;
      }

      const VALID_TRANSITIONS: Record<string, string[]> = {
        REQUESTED:       ['ACCEPTED', 'CANCELLED'],
        ACCEPTED:        ['DRIVER_EN_ROUTE', 'CANCELLED'],
        DRIVER_EN_ROUTE: ['ARRIVED', 'CANCELLED'],
        ARRIVED:         ['IN_PROGRESS', 'CANCELLED'],
        IN_PROGRESS:     ['COMPLETED', 'CANCELLED'],
      };
      const allowed = VALID_TRANSITIONS[ride.status] ?? [];
      if (!allowed.includes(data.status)) {
        this.logger.warn(`⛔ Transition invalide ${ride.status} → ${data.status} sur ride:${data.rideId}`);
        return;
      }

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: {
          status: data.status as any,
          cancelReason: data.cancelReason ?? null,
          ...(data.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(data.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });

      this.server.to(`ride:${data.rideId}`).emit('ride:status', {
        rideId: data.rideId,
        status: data.status,
      });
    } catch (e) {
      this.logger.error(`ride:status error: ${e}`);
    }
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  @SubscribeMessage('chat:message')
  handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string; content: string },
  ) {
    const senderId = (client as any).userId;
    if (!senderId || !data.rideId || !data.content?.trim()) return;

    this.server.to(`ride:${data.rideId}`).emit('chat:message', {
      senderId,
      content: data.content.trim(),
      sentAt: new Date().toISOString(),
    });
  }
}
