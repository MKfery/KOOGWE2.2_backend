// src/rides/rides.controller.ts
import {
  Controller, Post, Get, Patch, Delete, Body, Param, Req, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { RidesService, CreateRideDto, CreateDeliveryDto } from './rides.service';
import { RideStatus } from '@prisma/client';

@ApiTags('Rides')
@ApiBearerAuth()
@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une course VTC' })
  create(@Req() req: any, @Body() dto: CreateRideDto) {
    return this.ridesService.create(req.user.id, dto);
  }

  @Post('delivery')
  @ApiOperation({ summary: 'Créer une livraison' })
  createDelivery(@Req() req: any, @Body() dto: CreateDeliveryDto) {
    return this.ridesService.createDelivery(req.user.id, dto);
  }

  @Post('estimate')
  @ApiOperation({ summary: 'Estimer le prix' })
  estimatePrice(@Body() dto: any) {
    return this.ridesService.estimatePrice(dto);
  }

  @Post('scheduled')
  @ApiOperation({ summary: 'Course planifiée' })
  createScheduled(@Req() req: any, @Body() dto: any) {
    return this.ridesService.createScheduledRide(req.user.id, dto);
  }

  @Get('available')
  @ApiOperation({ summary: 'Courses disponibles pour les chauffeurs' })
  getAvailable(@Req() req: any, @Query('lat') lat: string, @Query('lng') lng: string, @Query('vehicleType') vehicleType?: string) {
    return this.ridesService.getAvailableRides(+lat, +lng, vehicleType);
  }

  @Get('history')
  getHistory(@Req() req: any) {
    return this.ridesService.getHistory(req.user.id, req.user.role);
  }

  @Get('upcoming')
  getUpcoming(@Req() req: any) {
    return this.ridesService.getUpcomingRides(req.user.id);
  }

  @Get('driver/stats')
  getDriverStats(@Req() req: any) {
    return this.ridesService.getDriverStats(req.user.id);
  }

  @Post('panic')
  triggerPanic(@Req() req: any, @Body() dto: { rideId?: string; lat: number; lng: number }) {
    return this.ridesService.triggerPanic(req.user.id, dto.rideId ?? null, dto.lat, dto.lng);
  }

  @Public()
  @Get('track/:token')
  trackByToken(@Param('token') token: string) {
    return this.ridesService.getRideByShareToken(token);
  }

  @Post(':id/share')
  generateShare(@Param('id') id: string, @Req() req: any) {
    return this.ridesService.generateShareToken(id, req.user.id);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Req() req: any) {
    return this.ridesService.acceptRide(id, req.user.id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: { status: RideStatus; cancelReason?: string }, @Req() req: any) {
    return this.ridesService.updateStatus(id, req.user.id, dto.status, dto.cancelReason);
  }

  @Patch(':id/cancel')
  cancelRide(@Param('id') id: string, @Req() req: any) {
    return this.ridesService.cancelRide(id, req.user.id, req.user.role);
  }

  @Post(':id/verify-pin')
  verifyPin(@Param('id') id: string, @Body('pin') pin: string) {
    return this.ridesService.verifyPin(id, pin);
  }

  @Post(':id/rate')
  rateRide(@Param('id') id: string, @Body() dto: { rating: number; comment?: string }, @Req() req: any) {
    return this.ridesService.rateRide(id, req.user.id, req.user.role, dto.rating, dto.comment);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ridesService.findById(id);
  }
}
