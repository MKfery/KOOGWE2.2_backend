// src/rides/rides.controller.ts
// ✅ VERSION PRODUCTION — requesterId toujours issu du JWT (@Request req)

import { Controller, Post, Get, Patch, Param, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RidesService } from './rides.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Rides')
@ApiBearerAuth()
@Controller('rides')
@UseGuards(JwtAuthGuard)
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  // === PASSAGER : créer une course ===
  @Post()
  createRide(@Request() req: any, @Body() body: any) {
    return this.ridesService.createRide(req.user.id, body);
  }

  // === CHAUFFEUR : courses disponibles ===
  @Get('available')
  getAvailableRides(@Request() req: any) {
    return this.ridesService.getAvailableRides(req.user.id);
  }

  // === CHAUFFEUR : accepter une course ===
  @Post(':id/accept')
  acceptRide(@Request() req: any, @Param('id') rideId: string) {
    return this.ridesService.acceptRide(rideId, req.user.id);
  }

  // === CHAUFFEUR / PASSAGER : changer le statut ===
  // ✅ FIX : requesterId passé depuis le JWT, plus depuis le body
  @Patch(':id/status')
  updateStatus(
    @Request() req: any,
    @Param('id') rideId: string,
    @Body() body: { status: string; cancelReason?: string },
  ) {
    return this.ridesService.updateRideStatus(rideId, req.user.id, body.status, body.cancelReason);
  }

  // === CHAUFFEUR : vérifier le PIN du passager ===
  // ✅ FIX : driverId toujours depuis le JWT
  @Post(':id/verify-pin')
  verifyPin(@Request() req: any, @Param('id') rideId: string, @Body() body: { pin: string }) {
    return this.ridesService.verifyPin(rideId, req.user.id, body.pin);
  }

  // === Historique ===
  @Get('me')
  getMyRides(@Request() req: any) {
    return this.ridesService.getUserRides(req.user.id);
  }
}
