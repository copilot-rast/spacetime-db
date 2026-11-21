import { defineBase, seedBase, type Tx } from '@stg/base';
import spacetimedb from './schema';
import { gameInit } from './game/init';

export const init = spacetimedb.init(ctx => {
  seedBase(ctx as unknown as Tx);
  gameInit(ctx);
});

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
