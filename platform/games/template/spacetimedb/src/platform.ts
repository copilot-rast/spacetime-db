import { defineBase, seedBase } from '@stg/base';
import { definePlayers, seedPlayers } from '@stg/players';
import spacetimedb from './schema';
import { gameInit } from './game/init';

function seedAll(ctx: unknown) {
  seedBase(ctx as never);
  seedPlayers(ctx as never);
}

export const init = spacetimedb.init(ctx => {
  seedAll(ctx);
  gameInit(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  seedAll(ctx);
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

export const {
  adminSaveAccountRules,
  adminSaveAppVersion,
  adminDeleteAppVersion,
  checkAppVersion,
  adminSaveCountry,
  adminSetCountryActive,
  adminDeleteCountry,
  setMyCountry,
  myProfile,
  expireRestrictions,
  myStatus,
  myTags,
  adminSetTagVisibility,
  adminSetPlayerTags,
  adminBulkPlayerTags,
  adminRestrict,
  adminLiftRestriction,
  adminPlayers,
  adminPlayer,
  adminRestrictions,
  adminSaveReportTitle,
  adminDeleteReportTitle,
  adminReportRules,
  adminSaveReportRules,
  reportPlayer,
  myReports,
  adminReports,
  adminReport,
  adminReportStatus,
  adminReportNote,
  adminResolveReport,
  adminModerationSummary,
} = definePlayers(spacetimedb);
