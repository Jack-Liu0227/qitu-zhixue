import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DirectoryModule } from '../directory/directory.module';
import { DirectoryService } from '../directory/directory.service';

@Module({
  imports: [DirectoryModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: 'DirectoryService',
      useExisting: DirectoryService,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
