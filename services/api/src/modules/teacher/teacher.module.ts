import { Module } from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { TeacherController } from './teacher.controller';
import { DirectoryModule } from '../directory/directory.module';
import { AuthModule } from '../identity-auth/auth.module';
import { FeedbackModule } from '../feedback/feedback.module';

@Module({
  imports: [DirectoryModule, AuthModule, FeedbackModule],
  controllers: [TeacherController],
  providers: [TeacherService],
  exports: [TeacherService],
})
export class TeacherModule {}
