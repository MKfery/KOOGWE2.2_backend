// src/users/users.controller.ts
import {
  Controller, Get, Patch, Post, Delete,
  Body, Param, Req, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService, UpdateProfileDto, UpdateVehicleDto } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil complet' })
  getMe(@Req() req: any) { return this.usersService.findById(req.user.id); }

  @Patch('profile')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Patch('vehicle')
  @ApiOperation({ summary: 'Mettre à jour le véhicule (chauffeur)' })
  updateVehicle(@Req() req: any, @Body() dto: UpdateVehicleDto) {
    return this.usersService.updateVehicle(req.user.id, dto);
  }

  @Get('driver-status')
  @ApiOperation({ summary: 'Statut onboarding chauffeur' })
  getDriverStatus(@Req() req: any) { return this.usersService.getDriverStatus(req.user.id); }

  @Post('submit-documents')
  @ApiOperation({ summary: 'Soumettre les documents pour validation admin' })
  submitDocuments(@Req() req: any) { return this.usersService.markDocumentsUploaded(req.user.id); }

  @Get('history')
  @ApiOperation({ summary: 'Historique courses passager' })
  getHistory(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 10) {
    return this.usersService.getRideHistory(req.user.id, +page, +limit);
  }

  @Get('notifications')
  getNotifications(@Req() req: any) { return this.usersService.getNotifications(req.user.id); }

  @Patch('notifications/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.usersService.markNotificationRead(id, req.user.id);
  }

  @Patch('notifications/read-all')
  markAllRead(@Req() req: any) { return this.usersService.markAllNotificationsRead(req.user.id); }

  @Get('saved-places')
  getSavedPlaces(@Req() req: any) { return this.usersService.getSavedPlaces(req.user.id); }

  @Post('saved-places')
  addSavedPlace(@Req() req: any, @Body() dto: any) {
    return this.usersService.addSavedPlace(req.user.id, dto);
  }

  @Delete('saved-places/:id')
  removeSavedPlace(@Req() req: any, @Param('id') id: string) {
    return this.usersService.removeSavedPlace(req.user.id, id);
  }
}
