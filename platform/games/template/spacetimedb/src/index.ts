import { schema } from 'spacetimedb/server';
import { baseTables, baseEnv, defineBase, seedBase, type Tx } from '@stg/base';

const spacetimedb = schema({ ...baseTables }, { env: { ...baseEnv } });
export default spacetimedb;

export const init = spacetimedb.init(ctx => seedBase(ctx as unknown as Tx));

export const {
  requestOtp,
  verifyOtp,
  logout,
  updateProfile,
  me,
  myRole,
  adminSettings,
  adminSaveSettings,
  adminCompleteSetup,
  adminSaveBrand,
  adminSmsProviders,
  adminSaveSmsProvider,
  adminDeleteSmsProvider,
  adminTestSms,
  adminTestPhones,
  adminSaveTestPhone,
  adminDeleteTestPhone,
  adminSandboxSms,
  adminClearSandboxSms,
  adminSaveLanguage,
  adminSetDefaultLanguage,
  adminDeleteLanguage,
  adminSaveKeyType,
  adminDeleteKeyType,
  adminSaveCategory,
  adminDeleteCategory,
  adminSaveTag,
  adminDeleteTag,
  adminAdmins,
  adminSetAdmin,
  adminRemoveAdmin,
  adminSetAccountStatus,
  adminAccounts,
  adminAudit,
  adminDashboard,
} = defineBase(spacetimedb);
