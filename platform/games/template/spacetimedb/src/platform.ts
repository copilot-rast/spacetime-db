import { defineBase, seedBase } from '@stg/base';
import { definePlayers, seedPlayers } from '@stg/players';
import { defineEconomy, seedEconomy } from '@stg/economy';
import spacetimedb from './schema';
import { gameInit } from './game/init';

function seedAll(ctx: unknown) {
  seedBase(ctx as never);
  seedPlayers(ctx as never);
  seedEconomy(ctx as never);
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

export const {
  myWallet,
  myMetas,
  shop,
  syncEconomy,
  adminSaveCurrency,
  adminDeleteCurrency,
  adminSaveMeta,
  adminDeleteMeta,
  adminSavePrize,
  adminDeletePrize,
  adminSavePrizeGroup,
  adminDeletePrizeGroup,
  adminSaveProduct,
  adminDeleteProduct,
  adminProducts,
  adminSaveGift,
  adminDeleteGift,
  adminGifts,
  redeemGift,
  adminUserEconomy,
  adminGrantPrize,
  adminAdjust,
  adminPaymentMethods,
  adminSavePaymentMethod,
  adminEconomySettings,
  adminSaveEconomySettings,
  purchaseStart,
  purchaseSubmit,
  purchaseStatus,
  myPayments,
  paymentCallback,
  routes,
  reconcilePayments,
  adminPayments,
  adminPayment,
  adminInquirePayment,
  adminRetryGrant,
  adminEconomySummary,
} = defineEconomy(spacetimedb);
