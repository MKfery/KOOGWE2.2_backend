import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppGateway } from './websocket.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class CommonModule {}