// src/face-verification/aws-rekognition.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RekognitionClient, DetectFacesCommand, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class AWSRekognitionService {
  private readonly logger = new Logger(AWSRekognitionService.name);
  private rekognition: RekognitionClient;
  private s3: S3Client;
  private readonly uploadsRoot = join(process.cwd(), 'uploads');
  readonly useAws: boolean;
  private readonly region: string;
  private readonly compareSimilarityThreshold: number;

  constructor() {
    this.region = process.env.AWS_REGION || 'eu-west-3';
    const envThreshold = Number(process.env.AWS_COMPARE_MIN_SIMILARITY ?? 60);
    this.compareSimilarityThreshold = Number.isFinite(envThreshold) ? Math.min(100, Math.max(0, envThreshold)) : 60;
    this.useAws = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET);

    if (this.useAws) {
      const cfg = {
        region: this.region,
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
      };
      this.rekognition = new RekognitionClient(cfg);
      this.s3 = new S3Client(cfg);
      this.logger.log('✅ AWS Rekognition/S3 activé');
    } else {
      this.logger.warn('⚠️ AWS non configuré — mode local activé (tests)');
      this.rekognition = {} as any;
      this.s3 = {} as any;
    }
  }

  // ✅ FIX V1: logs clairs en cas d'échec AWS
  async detectLiveness(imageBase64: string): Promise<{ isLive: boolean; confidence: number }> {
    if (!this.useAws) return { isLive: true, confidence: 99 };

    try {
      const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const result = await this.rekognition.send(new DetectFacesCommand({ Image: { Bytes: buffer }, Attributes: ['ALL'] }));

      if (!result.FaceDetails?.length) {
        this.logger.warn('AWS detectLiveness: aucun visage détecté');
        return { isLive: false, confidence: 0 };
      }

      const face = result.FaceDetails[0];
      const brightness = face.Quality?.Brightness ?? 0;
      const sharpness = face.Quality?.Sharpness ?? 0;
      const pitch = face.Pose?.Pitch ?? 0;
      const roll = face.Pose?.Roll ?? 0;
      const yaw = face.Pose?.Yaw ?? 0;
      const eyesOpen = (face.EyesOpen?.Value ?? false) && (face.EyesOpen?.Confidence ?? 0) > 85;

      const isLive = brightness > 40 && sharpness > 40 && Math.abs(pitch) < 35 && Math.abs(roll) < 35 && Math.abs(yaw) < 35 && eyesOpen;
      const confidence = face.Confidence ?? 0;

      this.logger.log(`AWS Liveness: brightness=${brightness.toFixed(0)} sharpness=${sharpness.toFixed(0)} isLive=${isLive} confidence=${confidence.toFixed(0)}`);
      return { isLive: !!isLive, confidence };
    } catch (error) {
      this.logger.error(`AWS detectLiveness error: ${error.message}`); // ✅ FIX: log clair
      return { isLive: false, confidence: 0 };
    }
  }

  async uploadFaceImage(userId: string, imageBase64: string): Promise<string> {
    const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    if (!this.useAws) {
      const dir = join(this.uploadsRoot, 'faces', userId);
      await mkdir(dir, { recursive: true });
      const filename = `${Date.now()}.jpg`;
      await writeFile(join(dir, filename), buffer);
      const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      return `${base}/uploads/faces/${userId}/${filename}`;
    }

    try {
      const bucket = process.env.AWS_S3_BUCKET!;
      const key = `faces/${userId}/${Date.now()}.jpg`;
      await this.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/jpeg' }));
      const url = this.region === 'us-east-1'
        ? `https://${bucket}.s3.amazonaws.com/${key}`
        : `https://${bucket}.s3.${this.region}.amazonaws.com/${key}`;
      this.logger.log(`AWS S3 upload OK: ${url}`);
      return url;
    } catch (error) {
      this.logger.error(`AWS S3 upload error: ${error.message}`);
      throw error;
    }
  }

  // ✅ FIX V1: compareFaces avec log clair (plus d'échec silencieux)
  async compareFaces(sourceBase64: string, targetBase64: string): Promise<{ similarity: number }> {
    if (!this.useAws) {
      if (!sourceBase64 || !targetBase64) return { similarity: 0 };
      return { similarity: 99 };
    }

    try {
      const src = Buffer.from(sourceBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const tgt = Buffer.from(targetBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

      const result = await this.rekognition.send(new CompareFacesCommand({
        SourceImage: { Bytes: src },
        TargetImage: { Bytes: tgt },
        SimilarityThreshold: this.compareSimilarityThreshold,
      }));

      if (result.FaceMatches?.length) {
        const similarity = result.FaceMatches[0].Similarity ?? 0;
        this.logger.log(`AWS compareFaces: similarity=${similarity.toFixed(0)}%`);
        return { similarity };
      }

      this.logger.warn('AWS compareFaces: aucune correspondance trouvée'); // ✅ FIX: log clair
      return { similarity: 0 };
    } catch (error: any) {
      if (error?.name === 'InvalidParameterException') {
        this.logger.warn(`AWS compareFaces: visage non détectable — ${error.message}`);
        return { similarity: 0 };
      }
      this.logger.error(`AWS compareFaces error: ${error.message}`); // ✅ FIX: log clair
      return { similarity: 0 };
    }
  }
}
