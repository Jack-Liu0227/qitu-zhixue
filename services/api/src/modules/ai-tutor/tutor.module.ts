import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';

@Module({
  imports: [AuthModule],
  controllers: [TutorController],
  providers: [TutorService],
  exports: [TutorService],
})
export class AiTutorModule {}
