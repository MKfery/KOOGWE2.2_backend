// src/admin/admin.controller.ts
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles, RolesGuard } from '../auth/guards/jwt-auth.guard';

// ✅ FIX V2: @Roles au niveau du contrôleur = toutes les routes admin protégées d'un coup
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('ADMIN')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  @Get('dashboard') @ApiOperation({ summary: 'Stats dashboard' })
  getDashboard() { return this.adminService.getDashboardStats(); }

  @Get('overview')
  getOverview() { return this.adminService.getDashboardStats(); }

  @Get('dashboard/stats')
  getDashboardStats() { return this.adminService.getDashboardStats(); }

  @Get('dashboard/rides/recent')
  getRecentRides() { return this.adminService.getRecentRides(); }

  @Get('dashboard/documents/pending')
  getDashboardPendingDocs() { return this.adminService.getPendingDocuments(); }

  // ─── Courses ───────────────────────────────────────────────────────────────
  @Get('rides')
  getRides(@Query('limit') limit?: string) { return this.adminService.getRecentRides(Number(limit || 50)); }

  @Get('rides/active')
  getActiveRides() { return this.adminService.getActiveRides(); }

  // ─── Chauffeurs ────────────────────────────────────────────────────────────
  @Get('drivers')
  getDrivers(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getDrivers(Number(page || 1), Number(limit || 50));
  }

  @Get('drivers/pending')
  getPendingDrivers() { return this.adminService.getPendingDrivers(); }

  @Patch('drivers/:id/suspend')
  suspendDriver(@Param('id') id: string) { return this.adminService.setUserStatus(id, 'SUSPENDED'); }

  @Patch('drivers/:id/activate')
  activateDriver(@Param('id') id: string) { return this.adminService.setUserStatus(id, 'ACTIVE'); }

  @Patch('drivers/:id/approval')
  setDriverApproval(@Param('id') id: string, @Body() body: { approved: boolean; adminNotes?: string }) {
    return this.adminService.setDriverApproval({ driverId: id, approved: body.approved, adminNotes: body.adminNotes });
  }

  // ─── Passagers ─────────────────────────────────────────────────────────────
  @Get('passengers')
  getPassengers(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getPassengers(Number(page || 1), Number(limit || 50));
  }

  @Patch('passengers/:id/suspend')
  suspendPassenger(@Param('id') id: string) { return this.adminService.setUserStatus(id, 'SUSPENDED'); }

  @Patch('passengers/:id/activate')
  activatePassenger(@Param('id') id: string) { return this.adminService.setUserStatus(id, 'ACTIVE'); }

  // ─── Documents ─────────────────────────────────────────────────────────────
  @Get('documents/pending')
  getPendingDocs() { return this.adminService.getPendingDocuments(); }

  @Get('documents/approved')
  getApprovedDocs() { return this.adminService.getApprovedDocuments(); }

  @Get('documents')
  getDocsByStatus(@Query('status') status?: string) { return this.adminService.getDocumentsByStatus(status); }

  @Patch('documents/:id/approve')
  approveDoc(@Req() req: any, @Param('id') id: string) {
    return this.adminService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'APPROVED' });
  }

  @Patch('documents/:id/reject')
  rejectDoc(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.adminService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'REJECTED', rejectionReason: body.reason });
  }

  @Patch('documents/:id/review')
  reviewDoc(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.reviewDocument({ documentId: id, adminId: req.user.id, ...body });
  }

  @Post('documents/:id/approve')
  approveDocPost(@Req() req: any, @Param('id') id: string) {
    return this.adminService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'APPROVED' });
  }

  @Post('documents/:id/reject')
  rejectDocPost(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'REJECTED', rejectionReason: body.reason || body.rejectionReason });
  }

  // ─── Finances ──────────────────────────────────────────────────────────────
  @Get('finance/stats')
  getFinanceStats() { return this.adminService.getFinanceStats(); }

  @Get('finance/transactions')
  getFinanceTx(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getFinanceTransactions(Number(page || 1), Number(limit || 20));
  }

  // ─── Config ────────────────────────────────────────────────────────────────
  @Get('config/pricing')
  getPricing() { return this.adminService.getPricingConfig(); }

  @Patch('config/pricing')
  updatePricing(@Body() body: any) { return this.adminService.updatePricingConfig(body); }

  // ─── Estimation de prix ────────────────────────────────────────────────────
  @Post('estimate-price')
  estimatePrice(@Body() body: {
    distanceKm: number;
    durationMin: number;
    vehicleType?: string;
    zone?: string;
    timeOfDay?: string;
    trafficLevel?: string;
    weatherCondition?: string;
    demandLevel?: string;
  }) { return this.adminService.estimatePrice(body); }

  // ─── Activité ──────────────────────────────────────────────────────────────
  @Get('activity/logins')
  getLoginActivity() { return this.adminService.getLoginActivity(); }

  @Get('login-activity')
  getLoginActivityAlias() { return this.adminService.getLoginActivity(); }
}
