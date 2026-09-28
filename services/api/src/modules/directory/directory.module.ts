import { Module } from '@nestjs/common';
import { DirectoryService } from './directory.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [DirectoryService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
