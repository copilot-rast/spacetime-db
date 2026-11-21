import { useSyncExternalStore } from 'react';
import { enP2, faP2, type DictP2 } from './i18n-p2.ts';
import { enP3, faP3, type DictP3 } from './i18n-p3.ts';
import { enP4, faP4, type DictP4 } from './i18n-p4.ts';

export type Locale = 'fa' | 'en';

const fa = {
  appName: 'پنل مدیریت',
  loading: 'در حال بارگذاری…',
  save: 'ذخیره',
  saved: 'ذخیره شد',
  cancel: 'انصراف',
  close: 'بستن',
  delete: 'حذف',
  edit: 'ویرایش',
  add: 'افزودن',
  create: 'ساختن',
  confirm: 'تأیید',
  back: 'قبلی',
  next: 'بعدی',
  yes: 'بله',
  no: 'خیر',
  all: 'همه',
  none: 'هیچ',
  active: 'فعال',
  inactive: 'غیرفعال',
  search: 'جست‌وجو',
  refresh: 'تازه‌سازی',
  required: 'الزامی',
  optional: 'اختیاری',
  readOnly: 'فقط خواندنی',
  actions: 'کارها',
  deleted: 'حذف شد',
  done: 'انجام شد',
  pageOf: 'صفحهٔ {p} از {n}',
  rangeOf: '{a} تا {b} از {n}',
  prevPage: 'صفحهٔ قبل',
  nextPage: 'صفحهٔ بعد',
  emptyList: 'چیزی برای نمایش نیست',
  areYouSure: 'مطمئن هستید؟',

  connTitle: 'اتصال به سرور',
  connHint: 'نشانی سرور SpacetimeDB و نام دیتابیس بازی را وارد کنید.',
  connServer: 'نشانی سرور',
  connServerHint: 'پیش‌فرض از همین آدرس پنل به سرور وصل می‌شود و روی شبکهٔ محلی و Tailscale کار می‌کند.',
  connDb: 'نام دیتابیس',
  connGo: 'اتصال',
  connConnecting: 'در حال اتصال به {db}…',
  connFailed: 'اتصال برقرار نشد',
  connRetry: 'تلاش دوباره',
  connChange: 'تغییر سرور',
  connResetToken: 'شروع با دستگاه تازه',
  connLost: 'اتصال قطع شد. دوباره وصل می‌شویم…',
  dbSwitch: 'تغییر دیتابیس',
  dbCurrent: 'دیتابیس فعلی',
  dbRecent: 'دیتابیس‌های اخیر',
  dbOther: 'دیتابیس دیگر',
  dbOpen: 'باز کردن',

  loginTitle: 'ورود به پنل',
  loginPhone: 'شمارهٔ موبایل',
  loginPhoneHint: 'کد ورود با پیامک فرستاده می‌شود.',
  loginSend: 'دریافت کد',
  loginCode: 'کد {n} رقمی',
  loginCodeSent: 'کد به {phone} فرستاده شد.',
  loginVerify: 'ورود',
  loginResend: 'ارسال دوباره',
  loginResendIn: 'ارسال دوباره تا {s} ثانیه',
  loginChangePhone: 'تغییر شماره',
  loginAttemptsLeft: '{n} تلاش دیگر باقی مانده',
  loginExpiresIn: 'کد تا {s} ثانیهٔ دیگر معتبر است',
  noAccessTitle: 'دسترسی ندارید',
  noAccessText: 'حساب {phone} نقش مدیریتی ندارد. از مالک پروژه بخواهید به شما نقش بدهد.',
  logout: 'خروج',

  navOverview: 'نمای کلی',
  navPlayers: 'بازیکن‌ها',
  navAccess: 'دسترسی',
  navSettings: 'تنظیمات پروژه',
  navDashboard: 'داشبورد',
  navAdmins: 'کاربران پنل',
  navAudit: 'گزارش کارها',
  navAllPlayers: 'همهٔ بازیکن‌ها',
  navActivePlayers: 'بازیکن‌های فعال',
  navBlockedPlayers: 'بازیکن‌های مسدود',
  navSetup: 'راه‌اندازی',
  palPlaceholder: 'برو به صفحه یا تنظیمات…',
  palPages: 'صفحه‌ها',
  palSettings: 'تنظیمات',
  palActions: 'کارها',
  palEmpty: 'چیزی پیدا نشد',
  palHint: 'با ↑ ↓ جابه‌جا شوید و Enter را بزنید',
  palTheme: 'تغییر پوسته',
  palLang: 'تغییر زبان پنل',
  openMenu: 'باز کردن منو',

  profile: 'حساب من',
  profileName: 'نام نمایشی',
  profileLang: 'زبان',
  profileTheme: 'پوسته',
  themeLight: 'روشن',
  themeDark: 'تیره',
  roleOwner: 'مالک',
  roleAdmin: 'مدیر',
  roleOperator: 'اپراتور',
  rolePlayer: 'بازیکن',

  dashTitle: 'داشبورد',
  dashAccounts: 'همهٔ حساب‌ها',
  dashNewToday: 'حساب تازهٔ امروز',
  dashActiveToday: 'فعال امروز',
  dashBlocked: 'مسدود',
  dashAdmins: 'مدیران',
  dashSessions: 'دستگاه‌های واردشده',
  dashLanguages: 'زبان‌های فعال',
  dashCategories: 'دسته‌ها',
  dashTags: 'برچسب‌ها',
  dashSms: 'سرویس پیامک',
  dashSmsNone: 'تنظیم نشده',
  dashSetupTitle: 'راه‌اندازی پروژه کامل نشده',
  dashSetupText: 'برند، زبان‌ها، سرویس پیامک و قوانین کد ورود را در چند قدم تنظیم کنید.',
  dashSetupGo: 'ادامهٔ راه‌اندازی',
  dashToday: 'امروز',
  dashProject: 'پروژه',

  plTitle: 'بازیکن‌ها',
  plSearch: 'جست‌وجوی شماره، نام یا شناسه',
  plStatus: 'وضعیت',
  plStatusActive: 'فعال',
  plStatusBlocked: 'مسدود',
  plColPlayer: 'بازیکن',
  plColPhone: 'موبایل',
  plColRole: 'نقش',
  plColStatus: 'وضعیت',
  plColLang: 'زبان',
  plColCreated: 'عضویت',
  plColLastLogin: 'آخرین ورود',
  plNoName: 'بی‌نام',
  plBlock: 'مسدود کردن',
  plUnblock: 'رفع مسدودی',
  plBlockConfirm: 'حساب {phone} مسدود شود؟ همهٔ دستگاه‌هایش از حساب خارج می‌شوند.',
  plUnblockConfirm: 'مسدودی حساب {phone} برداشته شود؟',
  plBlocked: 'حساب مسدود شد',
  plUnblocked: 'مسدودی برداشته شد',
  plEmpty: 'بازیکنی با این مشخصات پیدا نشد',
  plTotal: '{n} حساب',

  adTitle: 'کاربران پنل',
  adAdd: 'افزودن مدیر',
  adPhone: 'شمارهٔ موبایل',
  adRole: 'نقش',
  adRemove: 'برداشتن نقش',
  adRemoveConfirm: 'نقش مدیریتی {phone} برداشته شود؟',
  adRoleChanged: 'نقش تغییر کرد',
  adAdded: 'مدیر اضافه شد',
  adRemoved: 'نقش برداشته شد',
  adReadOnly: 'فقط مالک می‌تواند مدیران را تغییر دهد.',
  adYou: 'شما',
  adSince: 'از {d}',
  adRoleHelpOwner: 'همه کار، به‌همراه مدیریت مدیران',
  adRoleHelpAdmin: 'همهٔ تنظیمات، پیامک، وضعیت حساب‌ها و گزارش کارها',
  adRoleHelpOperator: 'دیدن داشبورد، بازیکن‌ها و تنظیمات',

  auTitle: 'گزارش کارها',
  auAction: 'نوع کار',
  auColTime: 'زمان',
  auColWho: 'انجام‌دهنده',
  auColAction: 'کار',
  auColTarget: 'هدف',
  auColDetail: 'جزئیات',
  auEmpty: 'کاری ثبت نشده',
  auSystem: 'سیستم',

  stTitle: 'تنظیمات پروژه',
  stGroupProject: 'پروژه',
  stGroupContent: 'محتوا',
  stGroupLogin: 'ورود و پیامک',
  stBrand: 'برند',
  stLanguages: 'زبان‌ها',
  stKeyTypes: 'نوع‌های کلید',
  stCategories: 'دسته‌ها',
  stTags: 'برچسب‌ها',
  stSms: 'سرویس‌های پیامک',
  stTestPhones: 'شماره‌های آزمایشی',
  stSandbox: 'صندوق پیامک آزمایشی',
  stOtp: 'قوانین کد ورود',
  stSetup: 'ویزارد راه‌اندازی',
  stSetupText: 'ویزارد راه‌اندازی را هر وقت خواستید دوباره باز کنید.',
  stSetupDone: 'راه‌اندازی کامل شده است.',
  stSetupPending: 'راه‌اندازی هنوز کامل نشده است.',
  stSetupOpen: 'باز کردن ویزارد',

  brName: 'نام بازی',
  brShortName: 'نام کوتاه',
  brShortHint: 'تا ۴۰ نویسه، برای جاهای کوچک',
  brLogo: 'نشانی لوگو',
  brIcon: 'نشانی آیکون',
  brColor: 'رنگ اصلی',
  brSupportPhone: 'تلفن پشتیبانی',
  brSupportEmail: 'ایمیل پشتیبانی',
  brWebsite: 'وب‌سایت',
  brUrlHint: 'با https:// یا / شروع شود',
  brPreview: 'پیش‌نمایش',
  brIdentity: 'هویت',
  brContact: 'راه‌های تماس',

  lgCode: 'کد زبان',
  lgCodeHint: 'مثل fa یا en-US',
  lgName: 'نام زبان',
  lgDir: 'جهت نوشتن',
  lgRtl: 'راست به چپ',
  lgLtr: 'چپ به راست',
  lgSort: 'ترتیب',
  lgDefault: 'پیش‌فرض',
  lgMakeDefault: 'پیش‌فرض کن',
  lgAdd: 'افزودن زبان',
  lgEdit: 'ویرایش زبان',
  lgDeleteConfirm: 'زبان {name} حذف شود؟ متن‌های این زبان دیگر نمایش داده نمی‌شوند.',
  lgDefaultChanged: 'زبان پیش‌فرض تغییر کرد',

  ktKey: 'کلید',
  ktKeyHint: 'حروف کوچک لاتین، عدد، - و _',
  ktTitle: 'عنوان',
  ktForCategory: 'برای دسته‌ها',
  ktForTag: 'برای برچسب‌ها',
  ktSystem: 'سیستمی',
  ktUse: 'کاربرد',
  ktAdd: 'افزودن نوع کلید',
  ktEdit: 'ویرایش نوع کلید',
  ktDeleteConfirm: 'نوع کلید {key} حذف شود؟',
  ktSystemHint: 'نوع سیستمی فقط عنوانش تغییر می‌کند.',
  ktPick: 'نوع کلید',
  ktQuick: 'نوع کلید تازه',

  ctAdd: 'افزودن دسته',
  ctAddChild: 'زیردسته',
  ctEdit: 'ویرایش دسته',
  ctTitle: 'عنوان',
  ctDescription: 'توضیح',
  ctParent: 'دستهٔ والد',
  ctNoParent: 'بدون والد',
  ctIcon: 'نشانی آیکون',
  ctSort: 'ترتیب',
  ctDeleteConfirm: 'دستهٔ {name} حذف شود؟',
  ctEmpty: 'هنوز دسته‌ای برای این نوع کلید نساخته‌اید',
  ctNoKeyType: 'نوع کلیدی برای دسته‌ها نیست. اول یکی بسازید.',
  ctQuick: 'دستهٔ تازه',

  tgAdd: 'افزودن برچسب',
  tgEdit: 'ویرایش برچسب',
  tgColor: 'رنگ',
  tgDeleteConfirm: 'برچسب {name} حذف شود؟',
  tgEmpty: 'هنوز برچسبی برای این نوع کلید نساخته‌اید',

  smAdd: 'افزودن سرویس',
  smEdit: 'ویرایش سرویس',
  smKind: 'نوع سرویس',
  smKindSandbox: 'آزمایشی (بدون پیامک)',
  smKindKavenegar: 'کاوه‌نگار',
  smKindSmsir: 'sms.ir',
  smName: 'نام',
  smApiKey: 'کلید API',
  smApiKeyKeep: 'خالی بماند تا کلید فعلی ({mask}) حفظ شود',
  smSender: 'شمارهٔ فرستنده',
  smSenderSmsir: 'شمارهٔ خط',
  smTemplateKavenegar: 'نام الگوی کد ورود',
  smTemplateKavenegarHint: 'با الگو، کد با verify/lookup فرستاده می‌شود. بدون الگو، متن ساده از شمارهٔ فرستنده.',
  smTemplateSmsir: 'شناسهٔ الگوی کد ورود',
  smTemplateSmsirHint: 'عدد. با الگو، کد با send/verify فرستاده می‌شود. بدون الگو، متن ساده از خط.',
  smCodeVar: 'نام متغیر کد در الگو',
  smCodeVarHint: 'پیش‌فرض CODE',
  smSandboxHint: 'پیامکی فرستاده نمی‌شود. متن پیام در صندوق پیامک آزمایشی دیده می‌شود.',
  smActive: 'سرویس فعال',
  smActivate: 'فعال کن',
  smActivated: 'سرویس فعال شد',
  smMakeActive: 'بعد از ذخیره فعال شود',
  smKey: 'کلید',
  smNoKey: 'بدون کلید',
  smTemplate: 'الگو',
  smTest: 'پیامک آزمایشی',
  smTestPhone: 'شمارهٔ گیرنده',
  smTestOtp: 'کد ورود با الگو فرستاده شود',
  smTestSend: 'ارسال',
  smTestSent: 'پیامک فرستاده شد ({mode})',
  smTestCode: 'کد فرستاده‌شده: {code}',
  smDeleteConfirm: 'سرویس {name} حذف شود؟',
  smActiveNoDelete: 'سرویس فعال را نمی‌شود حذف کرد',
  smEmpty: 'هیچ سرویس پیامکی ثبت نشده',

  tpPhone: 'شماره',
  tpCode: 'کد ثابت',
  tpCodeHint: '{n} رقم، هم‌اندازهٔ کد ورود',
  tpNote: 'یادداشت',
  tpAdd: 'افزودن شمارهٔ آزمایشی',
  tpEdit: 'ویرایش شمارهٔ آزمایشی',
  tpHint: 'این شماره‌ها (مثلاً برای بازبین فروشگاه) همیشه همان کد ثابت را می‌گیرند و پیامکی برایشان فرستاده نمی‌شود.',
  tpDeleteConfirm: 'شمارهٔ {phone} حذف شود؟',
  tpEmpty: 'شمارهٔ آزمایشی ثبت نشده',

  sbHint: 'پیام‌های سرویس آزمایشی، زنده و تا ۵۰ پیام آخر.',
  sbClear: 'پاک کردن صندوق',
  sbClearConfirm: 'همهٔ پیام‌های آزمایشی پاک شوند؟',
  sbEmpty: 'صندوق خالی است',
  sbLive: 'زنده',

  otLength: 'طول کد',
  otLengthHint: 'بین ۴ تا ۸ رقم',
  otTtl: 'اعتبار کد (ثانیه)',
  otTtlHint: 'بین ۳۰ تا ۹۰۰',
  otResend: 'فاصلهٔ ارسال دوباره (ثانیه)',
  otResendHint: 'بین ۱۰ تا ۶۰۰',
  otAttempts: 'تعداد تلاش',
  otAttemptsHint: 'بین ۱ تا ۱۰',
  otDaily: 'سقف کد روزانه برای هر شماره',
  otDailyHint: 'بین ۱ تا ۱۰۰',
  otIntro: 'این قوانین برای هر درخواست کد ورود تازه اعمال می‌شوند.',

  trDefault: 'زبان پیش‌فرض',
  trRequired: 'متن زبان پیش‌فرض ({lang}) الزامی است',

  wzTitle: 'راه‌اندازی پروژه',
  wzStep: 'قدم {n} از {total}',
  wzBrand: 'برند',
  wzBrandText: 'نام و رنگ بازی در پنل، پیامک ورود و اپ نمایش داده می‌شود.',
  wzLanguages: 'زبان‌ها',
  wzLanguagesText: 'زبان‌هایی که بازی پشتیبانی می‌کند. هر متن چندزبانه برای این زبان‌ها ورودی می‌گیرد.',
  wzSms: 'سرویس پیامک',
  wzSmsText: 'کد ورود با این سرویس فرستاده می‌شود. برای شروع، سرویس آزمایشی کافی است.',
  wzOtp: 'قوانین کد ورود',
  wzOtpText: 'طول کد، زمان اعتبار و سقف درخواست‌ها.',
  wzReview: 'مرور',
  wzReviewText: 'همه چیز ذخیره شده است. با پایان، راه‌اندازی کامل علامت می‌خورد.',
  wzFinish: 'پایان راه‌اندازی',
  wzLater: 'بعداً',
  wzFinished: 'راه‌اندازی کامل شد',
  wzSmsCurrent: 'سرویس فعال فعلی: {name}',
  wzSmsUse: 'سرویس تازه',
  wzTestSend: 'ارسال آزمایشی به',

  copy: 'کپی',
  copied: 'کپی شد',

  err: {
    NOT_LOGGED_IN: 'اول وارد شوید.',
    ACCOUNT_BLOCKED: 'این حساب مسدود شده است.',
    FORBIDDEN: 'اجازهٔ این کار را ندارید.',
    NOT_FOUND: 'پیدا نشد. شاید کس دیگری حذفش کرده.',
    INVALID_PHONE: 'شمارهٔ موبایل درست نیست.',
    INVALID_CODE: 'کد درست نیست. باید هم‌اندازهٔ کد ورود باشد.',
    INVALID_KEY: 'کلید فقط با حروف کوچک لاتین شروع می‌شود و عدد، - و _ می‌پذیرد.',
    INVALID_URL: 'نشانی باید با https:// یا / شروع شود.',
    INVALID_COLOR: 'رنگ باید به شکل #RRGGBB باشد.',
    INVALID_EMAIL: 'ایمیل درست نیست.',
    INVALID_ROLE: 'نقش نامعتبر است.',
    INVALID_STATUS: 'وضعیت نامعتبر است.',
    INVALID_DIR: 'جهت نوشتن نامعتبر است.',
    INVALID_LANGUAGE_CODE: 'کد زبان باید مثل fa یا en-US باشد.',
    INVALID_OTP_LENGTH: 'طول کد باید بین ۴ تا ۸ باشد.',
    INVALID_OTP_TTL: 'اعتبار کد باید بین ۳۰ تا ۹۰۰ ثانیه باشد.',
    INVALID_OTP_RESEND: 'فاصلهٔ ارسال دوباره باید بین ۱۰ تا ۶۰۰ ثانیه باشد.',
    INVALID_OTP_ATTEMPTS: 'تعداد تلاش باید بین ۱ تا ۱۰ باشد.',
    INVALID_OTP_DAILY_CAP: 'سقف روزانه باید بین ۱ تا ۱۰۰ باشد.',
    NAME_REQUIRED: 'نام را وارد کنید.',
    TITLE_REQUIRED: 'عنوان را دست‌کم برای یک زبان وارد کنید.',
    UNKNOWN_LANGUAGE: 'این زبان تعریف نشده یا فعال نیست.',
    LANGUAGE_INACTIVE: 'زبان غیرفعال نمی‌تواند پیش‌فرض باشد.',
    DEFAULT_LANGUAGE: 'زبان پیش‌فرض را نمی‌شود حذف کرد.',
    DEFAULT_LANGUAGE_INACTIVE: 'زبان پیش‌فرض را نمی‌شود غیرفعال کرد.',
    UNKNOWN_KEY_TYPE: 'این نوع کلید وجود ندارد.',
    KEY_TYPE_NOT_ALLOWED: 'این نوع کلید برای این کار مجاز نیست.',
    KEY_TYPE_UNUSED: 'نوع کلید باید دست‌کم برای دسته یا برچسب باشد.',
    KEY_TYPE_SYSTEM: 'نوع کلید سیستمی حذف نمی‌شود.',
    KEY_TYPE_IN_USE: 'این نوع کلید دسته یا برچسب دارد. اول آن‌ها را حذف کنید.',
    KEY_TAKEN: 'این کلید قبلاً استفاده شده است.',
    PARENT_NOT_FOUND: 'دستهٔ والد پیدا نشد.',
    PARENT_KEY_TYPE: 'دستهٔ والد باید همین نوع کلید را داشته باشد.',
    PARENT_CYCLE: 'دسته نمی‌تواند زیرمجموعهٔ خودش باشد.',
    CATEGORY_HAS_CHILDREN: 'این دسته زیردسته دارد. اول زیردسته‌ها را حذف کنید.',
    SMS_KIND_UNKNOWN: 'نوع سرویس پیامک ناشناخته است.',
    API_KEY_REQUIRED: 'کلید API را وارد کنید.',
    SMS_TEMPLATE_INVALID: 'شناسهٔ الگوی sms.ir باید عدد باشد.',
    PROVIDER_ACTIVE: 'سرویس فعال را نمی‌شود حذف کرد.',
    SMS_NOT_CONFIGURED: 'سرویس پیامک تنظیم نشده است.',
    SMS_FAILED: 'ارسال پیامک ناموفق بود. کلید و تنظیمات سرویس را بررسی کنید.',
    RETRY_LATER: 'کمی صبر کنید. تا {s} ثانیهٔ دیگر دوباره امتحان کنید.',
    DAILY_LIMIT: 'سقف کد امروز برای این شماره پر شده است.',
    LAST_OWNER: 'پروژه باید دست‌کم یک مالک داشته باشد.',
    CANNOT_CHANGE_SELF: 'وضعیت حساب خودتان را نمی‌توانید تغییر دهید.',
    CANNOT_BLOCK_OWNER: 'مالک پروژه مسدود نمی‌شود.',
    NOT_INITIALIZED: 'دیتابیس هنوز آماده نیست.',
    NO_CODE: 'کدی برای این شماره نیست. دوباره کد بگیرید.',
    EXPIRED: 'کد منقضی شده. دوباره کد بگیرید.',
    WRONG_CODE: 'کد اشتباه است.',
    TOO_MANY_ATTEMPTS: 'تلاش‌ها تمام شد. دوباره کد بگیرید.',
    NOT_CONNECTED: 'به سرور وصل نیستید.',
    UNKNOWN: 'خطای ناشناخته: {raw}',
  },

  act: {
    'settings.save': 'ذخیرهٔ قوانین کد',
    'setup.done': 'وضعیت راه‌اندازی',
    'brand.save': 'ذخیرهٔ برند',
    'sms.create': 'سرویس پیامک تازه',
    'sms.update': 'ویرایش سرویس پیامک',
    'sms.delete': 'حذف سرویس پیامک',
    'sms.test': 'پیامک آزمایشی',
    'test_phone.save': 'ذخیرهٔ شمارهٔ آزمایشی',
    'test_phone.delete': 'حذف شمارهٔ آزمایشی',
    'sandbox_sms.clear': 'پاک کردن صندوق آزمایشی',
    'language.create': 'زبان تازه',
    'language.update': 'ویرایش زبان',
    'language.default': 'تغییر زبان پیش‌فرض',
    'language.delete': 'حذف زبان',
    'key_type.create': 'نوع کلید تازه',
    'key_type.update': 'ویرایش نوع کلید',
    'key_type.delete': 'حذف نوع کلید',
    'category.create': 'دستهٔ تازه',
    'category.update': 'ویرایش دسته',
    'category.delete': 'حذف دسته',
    'tag.create': 'برچسب تازه',
    'tag.update': 'ویرایش برچسب',
    'tag.delete': 'حذف برچسب',
    'admin.set': 'تعیین نقش مدیر',
    'admin.remove': 'برداشتن نقش مدیر',
    'account.status': 'تغییر وضعیت حساب',
  } as Record<string, string>,

  actGroup: {
    'account.': 'حساب‌ها',
    'admin.': 'مدیران',
    'brand.': 'برند',
    'settings.': 'قوانین کد',
    'setup.': 'راه‌اندازی',
    'sms.': 'پیامک',
    'test_phone.': 'شماره‌های آزمایشی',
    'sandbox_sms.': 'صندوق آزمایشی',
    'language.': 'زبان‌ها',
    'key_type.': 'نوع‌های کلید',
    'category.': 'دسته‌ها',
    'tag.': 'برچسب‌ها',
  } as Record<string, string>,
};

export type DictBase = typeof fa;

const en: DictBase = {
  appName: 'Admin panel',
  loading: 'Loading…',
  save: 'Save',
  saved: 'Saved',
  cancel: 'Cancel',
  close: 'Close',
  delete: 'Delete',
  edit: 'Edit',
  add: 'Add',
  create: 'Create',
  confirm: 'Confirm',
  back: 'Back',
  next: 'Next',
  yes: 'Yes',
  no: 'No',
  all: 'All',
  none: 'None',
  active: 'Active',
  inactive: 'Inactive',
  search: 'Search',
  refresh: 'Refresh',
  required: 'Required',
  optional: 'Optional',
  readOnly: 'Read only',
  actions: 'Actions',
  deleted: 'Deleted',
  done: 'Done',
  pageOf: 'Page {p} of {n}',
  rangeOf: '{a}–{b} of {n}',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  emptyList: 'Nothing to show',
  areYouSure: 'Are you sure?',

  connTitle: 'Connect to a server',
  connHint: 'Enter the SpacetimeDB server address and the game database name.',
  connServer: 'Server address',
  connServerHint: 'The default goes through this panel’s own address, so it works locally and over Tailscale.',
  connDb: 'Database name',
  connGo: 'Connect',
  connConnecting: 'Connecting to {db}…',
  connFailed: 'Could not connect',
  connRetry: 'Try again',
  connChange: 'Change server',
  connResetToken: 'Start as a new device',
  connLost: 'Connection lost. Reconnecting…',
  dbSwitch: 'Switch database',
  dbCurrent: 'Current database',
  dbRecent: 'Recent databases',
  dbOther: 'Another database',
  dbOpen: 'Open',

  loginTitle: 'Sign in to the panel',
  loginPhone: 'Mobile number',
  loginPhoneHint: 'We will text you a login code.',
  loginSend: 'Get code',
  loginCode: '{n}-digit code',
  loginCodeSent: 'Code sent to {phone}.',
  loginVerify: 'Sign in',
  loginResend: 'Send again',
  loginResendIn: 'Send again in {s}s',
  loginChangePhone: 'Change number',
  loginAttemptsLeft: '{n} attempts left',
  loginExpiresIn: 'Code is valid for {s}s',
  noAccessTitle: 'No access',
  noAccessText: 'The account {phone} has no admin role. Ask the project owner to give you one.',
  logout: 'Log out',

  navOverview: 'Overview',
  navPlayers: 'Players',
  navAccess: 'Access',
  navSettings: 'Project settings',
  navDashboard: 'Dashboard',
  navAdmins: 'Panel users',
  navAudit: 'Audit log',
  navAllPlayers: 'All players',
  navActivePlayers: 'Active players',
  navBlockedPlayers: 'Blocked players',
  navSetup: 'Setup',
  palPlaceholder: 'Go to a page or setting…',
  palPages: 'Pages',
  palSettings: 'Settings',
  palActions: 'Actions',
  palEmpty: 'Nothing found',
  palHint: 'Use ↑ ↓ to move and Enter to open',
  palTheme: 'Toggle theme',
  palLang: 'Switch panel language',
  openMenu: 'Open menu',

  profile: 'My account',
  profileName: 'Display name',
  profileLang: 'Language',
  profileTheme: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  roleOwner: 'Owner',
  roleAdmin: 'Admin',
  roleOperator: 'Operator',
  rolePlayer: 'Player',

  dashTitle: 'Dashboard',
  dashAccounts: 'All accounts',
  dashNewToday: 'New today',
  dashActiveToday: 'Active today',
  dashBlocked: 'Blocked',
  dashAdmins: 'Admins',
  dashSessions: 'Signed-in devices',
  dashLanguages: 'Active languages',
  dashCategories: 'Categories',
  dashTags: 'Tags',
  dashSms: 'SMS service',
  dashSmsNone: 'Not set',
  dashSetupTitle: 'Project setup is not finished',
  dashSetupText: 'Set the brand, languages, SMS service and login code rules in a few steps.',
  dashSetupGo: 'Continue setup',
  dashToday: 'Today',
  dashProject: 'Project',

  plTitle: 'Players',
  plSearch: 'Search phone, name or id',
  plStatus: 'Status',
  plStatusActive: 'Active',
  plStatusBlocked: 'Blocked',
  plColPlayer: 'Player',
  plColPhone: 'Mobile',
  plColRole: 'Role',
  plColStatus: 'Status',
  plColLang: 'Language',
  plColCreated: 'Joined',
  plColLastLogin: 'Last login',
  plNoName: 'No name',
  plBlock: 'Block',
  plUnblock: 'Unblock',
  plBlockConfirm: 'Block {phone}? All of its devices will be signed out.',
  plUnblockConfirm: 'Unblock {phone}?',
  plBlocked: 'Account blocked',
  plUnblocked: 'Account unblocked',
  plEmpty: 'No players match',
  plTotal: '{n} accounts',

  adTitle: 'Panel users',
  adAdd: 'Add admin',
  adPhone: 'Mobile number',
  adRole: 'Role',
  adRemove: 'Remove role',
  adRemoveConfirm: 'Remove the admin role of {phone}?',
  adRoleChanged: 'Role changed',
  adAdded: 'Admin added',
  adRemoved: 'Role removed',
  adReadOnly: 'Only an owner can change admins.',
  adYou: 'You',
  adSince: 'since {d}',
  adRoleHelpOwner: 'Everything, including managing admins',
  adRoleHelpAdmin: 'All settings, SMS, account status and the audit log',
  adRoleHelpOperator: 'Sees the dashboard, players and settings',

  auTitle: 'Audit log',
  auAction: 'Action',
  auColTime: 'Time',
  auColWho: 'By',
  auColAction: 'Action',
  auColTarget: 'Target',
  auColDetail: 'Detail',
  auEmpty: 'No actions recorded',
  auSystem: 'System',

  stTitle: 'Project settings',
  stGroupProject: 'Project',
  stGroupContent: 'Content',
  stGroupLogin: 'Login and SMS',
  stBrand: 'Brand',
  stLanguages: 'Languages',
  stKeyTypes: 'Key types',
  stCategories: 'Categories',
  stTags: 'Tags',
  stSms: 'SMS services',
  stTestPhones: 'Test phones',
  stSandbox: 'Sandbox inbox',
  stOtp: 'Login code rules',
  stSetup: 'Setup wizard',
  stSetupText: 'Open the setup wizard again whenever you like.',
  stSetupDone: 'Setup is finished.',
  stSetupPending: 'Setup is not finished yet.',
  stSetupOpen: 'Open wizard',

  brName: 'Game name',
  brShortName: 'Short name',
  brShortHint: 'Up to 40 characters, for small places',
  brLogo: 'Logo URL',
  brIcon: 'Icon URL',
  brColor: 'Primary color',
  brSupportPhone: 'Support phone',
  brSupportEmail: 'Support email',
  brWebsite: 'Website',
  brUrlHint: 'Starts with https:// or /',
  brPreview: 'Preview',
  brIdentity: 'Identity',
  brContact: 'Contact',

  lgCode: 'Language code',
  lgCodeHint: 'Like fa or en-US',
  lgName: 'Language name',
  lgDir: 'Direction',
  lgRtl: 'Right to left',
  lgLtr: 'Left to right',
  lgSort: 'Order',
  lgDefault: 'Default',
  lgMakeDefault: 'Make default',
  lgAdd: 'Add language',
  lgEdit: 'Edit language',
  lgDeleteConfirm: 'Delete {name}? Texts in this language will no longer show.',
  lgDefaultChanged: 'Default language changed',

  ktKey: 'Key',
  ktKeyHint: 'Lowercase Latin letters, digits, - and _',
  ktTitle: 'Title',
  ktForCategory: 'For categories',
  ktForTag: 'For tags',
  ktSystem: 'System',
  ktUse: 'Used for',
  ktAdd: 'Add key type',
  ktEdit: 'Edit key type',
  ktDeleteConfirm: 'Delete key type {key}?',
  ktSystemHint: 'Only the title of a system key type can change.',
  ktPick: 'Key type',
  ktQuick: 'New key type',

  ctAdd: 'Add category',
  ctAddChild: 'Sub-category',
  ctEdit: 'Edit category',
  ctTitle: 'Title',
  ctDescription: 'Description',
  ctParent: 'Parent category',
  ctNoParent: 'No parent',
  ctIcon: 'Icon URL',
  ctSort: 'Order',
  ctDeleteConfirm: 'Delete category {name}?',
  ctEmpty: 'No categories for this key type yet',
  ctNoKeyType: 'No key type allows categories. Create one first.',
  ctQuick: 'New category',

  tgAdd: 'Add tag',
  tgEdit: 'Edit tag',
  tgColor: 'Color',
  tgDeleteConfirm: 'Delete tag {name}?',
  tgEmpty: 'No tags for this key type yet',

  smAdd: 'Add service',
  smEdit: 'Edit service',
  smKind: 'Service kind',
  smKindSandbox: 'Sandbox (no SMS)',
  smKindKavenegar: 'Kavenegar',
  smKindSmsir: 'sms.ir',
  smName: 'Name',
  smApiKey: 'API key',
  smApiKeyKeep: 'Leave empty to keep the current key ({mask})',
  smSender: 'Sender number',
  smSenderSmsir: 'Line number',
  smTemplateKavenegar: 'Login code template name',
  smTemplateKavenegarHint: 'With a template, codes go through verify/lookup. Without it, plain text from the sender.',
  smTemplateSmsir: 'Login code template id',
  smTemplateSmsirHint: 'A number. With a template, codes go through send/verify. Without it, plain text from the line.',
  smCodeVar: 'Code parameter name',
  smCodeVarHint: 'Default CODE',
  smSandboxHint: 'No SMS is sent. The text shows up in the sandbox inbox.',
  smActive: 'Active service',
  smActivate: 'Activate',
  smActivated: 'Service activated',
  smMakeActive: 'Activate after saving',
  smKey: 'Key',
  smNoKey: 'No key',
  smTemplate: 'Template',
  smTest: 'Test SMS',
  smTestPhone: 'Recipient',
  smTestOtp: 'Send a login code through the template',
  smTestSend: 'Send',
  smTestSent: 'SMS sent ({mode})',
  smTestCode: 'Code sent: {code}',
  smDeleteConfirm: 'Delete service {name}?',
  smActiveNoDelete: 'The active service cannot be deleted',
  smEmpty: 'No SMS services yet',

  tpPhone: 'Phone',
  tpCode: 'Fixed code',
  tpCodeHint: '{n} digits, same as the login code',
  tpNote: 'Note',
  tpAdd: 'Add test phone',
  tpEdit: 'Edit test phone',
  tpHint: 'These phones (for example a store reviewer) always get their fixed code and never receive an SMS.',
  tpDeleteConfirm: 'Delete {phone}?',
  tpEmpty: 'No test phones yet',

  sbHint: 'Messages from the sandbox service, live, last 50.',
  sbClear: 'Clear inbox',
  sbClearConfirm: 'Delete all sandbox messages?',
  sbEmpty: 'The inbox is empty',
  sbLive: 'Live',

  otLength: 'Code length',
  otLengthHint: '4 to 8 digits',
  otTtl: 'Code lifetime (seconds)',
  otTtlHint: '30 to 900',
  otResend: 'Resend wait (seconds)',
  otResendHint: '10 to 600',
  otAttempts: 'Attempts',
  otAttemptsHint: '1 to 10',
  otDaily: 'Daily codes per phone',
  otDailyHint: '1 to 100',
  otIntro: 'These rules apply to every new login code request.',

  trDefault: 'Default language',
  trRequired: 'The default language ({lang}) text is required',

  wzTitle: 'Project setup',
  wzStep: 'Step {n} of {total}',
  wzBrand: 'Brand',
  wzBrandText: 'The game name and color show in the panel, the login SMS and the app.',
  wzLanguages: 'Languages',
  wzLanguagesText: 'The languages your game supports. Every multilingual text asks for these languages.',
  wzSms: 'SMS service',
  wzSmsText: 'Login codes go out through this service. The sandbox is enough to start.',
  wzOtp: 'Login code rules',
  wzOtpText: 'Code length, lifetime and request limits.',
  wzReview: 'Review',
  wzReviewText: 'Everything is saved. Finishing marks the setup as done.',
  wzFinish: 'Finish setup',
  wzLater: 'Later',
  wzFinished: 'Setup finished',
  wzSmsCurrent: 'Active service: {name}',
  wzSmsUse: 'New service',
  wzTestSend: 'Send a test to',

  copy: 'Copy',
  copied: 'Copied',

  err: {
    NOT_LOGGED_IN: 'Sign in first.',
    ACCOUNT_BLOCKED: 'This account is blocked.',
    FORBIDDEN: 'You are not allowed to do this.',
    NOT_FOUND: 'Not found. Someone may have deleted it.',
    INVALID_PHONE: 'The mobile number is not valid.',
    INVALID_CODE: 'The code is not valid. It must match the login code length.',
    INVALID_KEY: 'A key starts with a lowercase Latin letter and may contain digits, - and _.',
    INVALID_URL: 'The address must start with https:// or /.',
    INVALID_COLOR: 'The color must look like #RRGGBB.',
    INVALID_EMAIL: 'The email is not valid.',
    INVALID_ROLE: 'Invalid role.',
    INVALID_STATUS: 'Invalid status.',
    INVALID_DIR: 'Invalid text direction.',
    INVALID_LANGUAGE_CODE: 'A language code looks like fa or en-US.',
    INVALID_OTP_LENGTH: 'Code length must be 4 to 8.',
    INVALID_OTP_TTL: 'Code lifetime must be 30 to 900 seconds.',
    INVALID_OTP_RESEND: 'Resend wait must be 10 to 600 seconds.',
    INVALID_OTP_ATTEMPTS: 'Attempts must be 1 to 10.',
    INVALID_OTP_DAILY_CAP: 'The daily cap must be 1 to 100.',
    NAME_REQUIRED: 'Enter a name.',
    TITLE_REQUIRED: 'Enter a title in at least one language.',
    UNKNOWN_LANGUAGE: 'This language is not defined or not active.',
    LANGUAGE_INACTIVE: 'An inactive language cannot be the default.',
    DEFAULT_LANGUAGE: 'The default language cannot be deleted.',
    DEFAULT_LANGUAGE_INACTIVE: 'The default language cannot be turned off.',
    UNKNOWN_KEY_TYPE: 'This key type does not exist.',
    KEY_TYPE_NOT_ALLOWED: 'This key type is not allowed here.',
    KEY_TYPE_UNUSED: 'A key type must be for categories, tags or both.',
    KEY_TYPE_SYSTEM: 'A system key type cannot be deleted.',
    KEY_TYPE_IN_USE: 'This key type has categories or tags. Delete them first.',
    KEY_TAKEN: 'This key is already used.',
    PARENT_NOT_FOUND: 'The parent category was not found.',
    PARENT_KEY_TYPE: 'The parent must have the same key type.',
    PARENT_CYCLE: 'A category cannot sit under itself.',
    CATEGORY_HAS_CHILDREN: 'This category has sub-categories. Delete them first.',
    SMS_KIND_UNKNOWN: 'Unknown SMS service kind.',
    API_KEY_REQUIRED: 'Enter the API key.',
    SMS_TEMPLATE_INVALID: 'An sms.ir template id must be a number.',
    PROVIDER_ACTIVE: 'The active service cannot be deleted.',
    SMS_NOT_CONFIGURED: 'No SMS service is set up.',
    SMS_FAILED: 'Sending the SMS failed. Check the service key and settings.',
    RETRY_LATER: 'Please wait. Try again in {s} seconds.',
    DAILY_LIMIT: 'This phone reached today’s code limit.',
    LAST_OWNER: 'The project needs at least one owner.',
    CANNOT_CHANGE_SELF: 'You cannot change the status of your own account.',
    CANNOT_BLOCK_OWNER: 'A project owner cannot be blocked.',
    NOT_INITIALIZED: 'The database is not ready yet.',
    NO_CODE: 'There is no code for this number. Ask for a new one.',
    EXPIRED: 'The code expired. Ask for a new one.',
    WRONG_CODE: 'Wrong code.',
    TOO_MANY_ATTEMPTS: 'No attempts left. Ask for a new code.',
    NOT_CONNECTED: 'Not connected to the server.',
    UNKNOWN: 'Unexpected error: {raw}',
  },

  act: {
    'settings.save': 'Saved code rules',
    'setup.done': 'Setup status',
    'brand.save': 'Saved brand',
    'sms.create': 'New SMS service',
    'sms.update': 'Edited SMS service',
    'sms.delete': 'Deleted SMS service',
    'sms.test': 'Test SMS',
    'test_phone.save': 'Saved test phone',
    'test_phone.delete': 'Deleted test phone',
    'sandbox_sms.clear': 'Cleared sandbox inbox',
    'language.create': 'New language',
    'language.update': 'Edited language',
    'language.default': 'Changed default language',
    'language.delete': 'Deleted language',
    'key_type.create': 'New key type',
    'key_type.update': 'Edited key type',
    'key_type.delete': 'Deleted key type',
    'category.create': 'New category',
    'category.update': 'Edited category',
    'category.delete': 'Deleted category',
    'tag.create': 'New tag',
    'tag.update': 'Edited tag',
    'tag.delete': 'Deleted tag',
    'admin.set': 'Set admin role',
    'admin.remove': 'Removed admin role',
    'account.status': 'Changed account status',
  },

  actGroup: {
    'account.': 'Accounts',
    'admin.': 'Admins',
    'brand.': 'Brand',
    'settings.': 'Code rules',
    'setup.': 'Setup',
    'sms.': 'SMS',
    'test_phone.': 'Test phones',
    'sandbox_sms.': 'Sandbox inbox',
    'language.': 'Languages',
    'key_type.': 'Key types',
    'category.': 'Categories',
    'tag.': 'Tags',
  },
};

function merge(base: DictBase, p2: DictP2, p3: DictP3, p4: DictP4) {
  return {
    ...base,
    ...p2,
    ...p3,
    ...p4,
    err: { ...base.err, ...p2.errP2, ...p3.errP3, ...p4.errP4 } as Record<string, string>,
    act: { ...base.act, ...p2.actP2, ...p3.actP3, ...p4.actP4 },
    actGroup: { ...base.actGroup, ...p2.actGroupP2, ...p3.actGroupP3, ...p4.actGroupP4 },
    fieldP2: { ...p2.fieldP2, ...p4.fieldP4 } as Record<string, string>,
  };
}

export type Dict = ReturnType<typeof merge>;

const dicts: Record<Locale, Dict> = { fa: merge(fa, faP2, faP3, faP4), en: merge(en, enP2, enP3, enP4) };

export type StrKey = { [K in keyof Dict]: Dict[K] extends string ? K : never }[keyof Dict];

let locale: Locale = (localStorage.getItem('stg.locale') as Locale) === 'en' ? 'en' : 'fa';
const listeners = new Set<() => void>();

function applyDocument() {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  document.title = dicts[locale].appName;
}
applyDocument();

export function setLocale(l: Locale) {
  locale = l;
  localStorage.setItem('stg.locale', l);
  applyDocument();
  listeners.forEach(f => f());
}

window.addEventListener('storage', e => {
  if (e.key === 'stg.locale' && (e.newValue === 'fa' || e.newValue === 'en') && e.newValue !== locale) setLocale(e.newValue);
});

export function getLocale() {
  return locale;
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    f => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => locale
  );
}

export function digits(s: string | number | bigint, l: Locale = locale): string {
  const v = String(s);
  return l === 'fa' ? v.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : v;
}

export function numeric(s: string): string {
  return /^[0-9+\s-]+$/.test(s) ? digits(s) : s;
}

export function latin(s: string): string {
  return s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

function fill(s: string, vars?: Record<string, string | number | bigint>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined) return '';
    return typeof v === 'string' ? v : digits(v);
  });
}

export function t(key: StrKey, vars?: Record<string, string | number | bigint>): string {
  return fill(dicts[locale][key] as string, vars);
}

export function tIn(l: Locale, key: StrKey): string {
  return dicts[l][key] as string;
}

export function num(n: number | bigint): string {
  const v = typeof n === 'bigint' ? n.toString() : n.toLocaleString('en-US', { useGrouping: false });
  const grouped = v.replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'fa' ? '٬' : ',');
  return digits(grouped);
}

export function phone(p: string): string {
  if (p.startsWith('admin:')) return p.slice(6);
  if (p.startsWith('deleted-admin:')) return p.split(':')[1] ?? p;
  return digits(p);
}

export function date(d: Date, withTime = true): string {
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  const s = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-persian-nu-arabext' : 'en-GB', opts).format(d);
  return digits(s);
}

export function actionLabel(action: string): string {
  return dicts[locale].act[action] ?? action;
}

export function actionGroups(): [string, string][] {
  return Object.entries(dicts[locale].actGroup);
}

const ERR_CODES = Object.keys(dicts.fa.err).filter(k => k !== 'UNKNOWN' && k !== 'GATEWAY_CODE');

export type ErrInfo = { code: string; seconds?: number; field?: string; extra?: string; raw: string };

export function parseError(e: unknown): ErrInfo {
  const raw = typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
  const m = raw.match(/RETRY_LATER:(\d+)/);
  if (m) return { code: 'RETRY_LATER', seconds: Number(m[1]), raw };
  const rule = raw.match(/INVALID_RULE:(\w+)/);
  if (rule) return { code: 'INVALID_RULE', field: rule[1], raw };
  const gw = raw.match(/\b((?:ZARINPAL|ZIBAL)_-?\w+)/);
  if (gw && !ERR_CODES.includes(gw[1])) return { code: 'GATEWAY_CODE', field: gw[1], raw };
  const sfx = [...raw.matchAll(/\b([A-Z][A-Z0-9_]*[A-Z0-9]):([^\s,]+)/g)].filter(m => ERR_CODES.includes(m[1]));
  if (sfx.length) {
    const m = sfx[sfx.length - 1];
    const parts = m[2].split(':');
    const secs = /^\d+$/.test(parts[0]) ? Number(parts[0]) : undefined;
    return { code: m[1], field: parts[0], extra: parts[1], seconds: secs, raw };
  }
  const found = (raw.match(/[A-Z][A-Z0-9_]{2,}/g) ?? []).filter(c => ERR_CODES.includes(c));
  if (found.length) return { code: found[found.length - 1], raw };
  return { code: 'UNKNOWN', raw };
}

export function errorText(e: unknown | ErrInfo, seconds?: number): string {
  const info = e && typeof e === 'object' && 'code' in (e as object) && 'raw' in (e as object) ? (e as ErrInfo) : parseError(e);
  const errs = dicts[locale].err as Record<string, string>;
  const s = seconds ?? info.seconds ?? 0;
  const field = info.field ? dicts[locale].fieldP2[info.field] ?? info.field : '';
  return fill(errs[info.code] ?? errs.UNKNOWN, { s, raw: info.raw.slice(0, 160), field, code: info.field ?? '', n: info.field && /^\d+(\.\d+)?$/.test(info.field) ? digits(info.field) : info.field ?? '', m: info.extra ? digits(info.extra) : '' });
}

export function codeText(code: string): string {
  return errorText({ code, raw: code });
}

export function roleLabel(role: string): string {
  if (role === 'owner') return t('roleOwner');
  if (role === 'admin') return t('roleAdmin');
  if (role === 'operator') return t('roleOperator');
  return t('rolePlayer');
}

export function withLocale<T>(l: Locale, fn: () => T): T {
  const prev = locale;
  locale = l;
  try {
    return fn();
  } finally {
    locale = prev;
  }
}
