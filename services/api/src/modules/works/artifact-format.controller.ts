import { Controller, Get, Header, Headers, Param, Query, StreamableFile } from '@nestjs/common';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ArtifactFormatService } from './artifact-format.service';

@Controller('artifacts')
export class ArtifactFormatController {
  constructor(private readonly formats: ArtifactFormatService, private readonly auth: AuthService) {}

  @Get(':id/versions/:versionId/export')
  @Header('Cache-Control', 'no-store')
  async export(@Headers('cookie') cookie: string | undefined, @Param('id') id: string,
    @Param('versionId') versionId: string, @Query('format') format: string) {
    const result = await this.formats.export(requireAnyRole(this.auth, cookie), id, versionId, format);
    return new StreamableFile(result.bytes, { type: result.mimeType, length: result.bytes.length,
      disposition: `attachment; filename="artifact.${format}"; filename*=UTF-8''${encodeURIComponent(result.filename).replace(/'/g, '%27')}` });
  }
}
