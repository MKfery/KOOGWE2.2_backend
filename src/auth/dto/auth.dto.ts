// src/auth/dto/auth.dto.ts
import { IsEmail, IsString, Length, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @ApiPropertyOptional({ enum: ['fr', 'en', 'es', 'pt', 'ht'] })
  @IsOptional()
  @IsIn(['fr', 'en', 'es', 'pt', 'ht'])
  language?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'jean.dupont@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '482910' })
  @IsString()
  @Length(6, 6, { message: 'Le code OTP doit contenir 6 chiffres' })
  code: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}
