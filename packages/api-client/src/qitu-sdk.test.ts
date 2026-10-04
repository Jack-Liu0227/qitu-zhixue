import { createQituReadSDK, type QituReadSDK } from './qitu-sdk';
import type { MasteryReadPort } from '@qitu/contracts';

type AssertTrue<T extends true> = T;
type _ReadSDKIsMasteryOnly = AssertTrue<Exclude<keyof QituReadSDK, 'mastery'> extends never ? true : false>;
type _ReadSDKUsesReadPort = AssertTrue<
  QituReadSDK['mastery'] extends MasteryReadPort ? true : false
>;

type _CreateReadSDKReturnsReadOnly = AssertTrue<
  ReturnType<typeof createQituReadSDK> extends QituReadSDK ? true : false
>;

// Compile-time contract: the browser facade cannot expose transport writes.
type _ReadSDKHasNoWrites = AssertTrue<
  'post' extends keyof QituReadSDK
    ? false
    : 'patch' extends keyof QituReadSDK
      ? false
      : true
>;

export const readSDKTypeChecks: readonly [
  _ReadSDKIsMasteryOnly,
  _ReadSDKUsesReadPort,
  _CreateReadSDKReturnsReadOnly,
  _ReadSDKHasNoWrites,
] = [true, true, true, true];
