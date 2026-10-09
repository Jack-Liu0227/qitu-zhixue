import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseConsultationInput, normalizePhone } from './public-content.validation';

function expectInvalid(body: unknown): BadRequestException {
  try {
    parseConsultationInput(body);
  } catch (error) {
    assert.ok(error instanceof BadRequestException, '应抛出 BadRequestException');
    return error;
  }
  throw new Error('期望校验失败，但通过了');
}

describe('parseConsultationInput', () => {
  it('接受合法载荷并归一化：去空格、可选中括号、留言空串转 null', () => {
    const parsed = parseConsultationInput({
      name: '  张同学  ',
      phone: '138 0000 1111',
      identity: 'student',
      message: '   ',
    });

    assert.deepEqual(parsed, {
      name: '张同学',
      phone: '13800001111',
      identity: 'student',
      message: null,
    });
  });

  it('拒绝未知字段（而不是忽略），避免脏数据悄悄落库', () => {
    const error = expectInvalid({
      name: '张同学',
      phone: '13800001111',
      identity: 'parent',
      schoolId: 'school-demo',
    });

    const body = error.getResponse() as { code: string; errors?: { path?: string }[] };
    assert.equal(body.code, 'CONSULTATION_INVALID');
    assert.ok(body.errors?.some((item) => item.path === 'schoolId'));
  });

  it('缺少必填字段时报错并带字段级 errors', () => {
    const error = expectInvalid({ phone: '13800001111', identity: 'parent' });
    const body = error.getResponse() as { errors?: { path?: string }[] };
    assert.ok(body.errors?.some((item) => item.path === 'name'));
  });

  it('身份必须在白名单内', () => {
    const error = expectInvalid({ name: '张同学', phone: '13800001111', identity: 'admin' });
    const body = error.getResponse() as { errors?: { path?: string }[] };
    assert.ok(body.errors?.some((item) => item.path === 'identity'));
  });

  it('电话号码格式错误被拒绝，座机号被接受', () => {
    assert.throws(() => parseConsultationInput({ name: '张', phone: '12345', identity: 'parent' }));

    const parsed = parseConsultationInput({
      name: '林老师',
      phone: '010-8888 8888',
      identity: 'school',
    });
    assert.equal(parsed.phone, '01088888888');
  });

  it('超长字段被拒绝：姓名 > 40 / 留言 > 500', () => {
    assert.throws(() =>
      parseConsultationInput({
        name: '张'.repeat(41),
        phone: '13800001111',
        identity: 'parent',
      }),
    );
    assert.throws(() =>
      parseConsultationInput({
        name: '张同学',
        phone: '13800001111',
        identity: 'parent',
        message: 'x'.repeat(501),
      }),
    );
  });

  it('拒绝非对象请求体（数组 / null / 字符串）', () => {
    assert.throws(() => parseConsultationInput(null));
    assert.throws(() => parseConsultationInput([]));
    assert.throws(() => parseConsultationInput('name=x'));
  });
});

describe('normalizePhone', () => {
  it('剔除空格、连字符与中文括号', () => {
    assert.equal(normalizePhone('（021）8888-8888'), '02188888888');
  });
});
