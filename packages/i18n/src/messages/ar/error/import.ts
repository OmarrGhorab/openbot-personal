import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} مش JSON صالح.",
  "error.import.notAgentExport": "{manifest} مش تصدير إيجنت من OpenBot.",
  "error.import.newerExportSkill": "التصدير ده اتعمل بمهارة تصدير أحدث. حدّث OpenBot وجرّب تاني.",
  "error.import.noAgents": "التصدير مفيهوش أي إيجنتات.",
  "error.import.tooManyAgents": "التصدير فيه أكتر من {limit} إيجنت.",
  "error.import.tooManyChannels": "التصدير فيه أكتر من {limit} قناة.",
  "error.import.channelSkipped": "{name}: القناة اتخطّت لأن مفيش ولا إيجنت من إيجنتاتها في التصدير.",
  "error.import.membersLeftOut": "{name}: الأعضاء اللي مش إيجنتات في التصدير ده اتساب.",
  "error.import.leadNotMember": "{name}: القائد مش عضو، فالقناة مفيهاش قائد.",
  "error.import.routineLimit": "{name}: أول {limit} روتين بس هما اللي اتستوردوا.",
  "error.import.routineInvalid": "{name}: الروتين «{routine}» اتخطّى لأن اسمه أو نصه أو جدوله مش صالح.",
  "error.import.memoriesSkipped": "{name}: {skipped} ذكرى اتخطّت لأنها فاضية أو أطول من {limit} حرف.",
  "error.import.memoryLimit": "{name}: أول {limit} ذكرى بس هما اللي اتستوردوا.",
  "error.import.manifestMissing": "التصدير لازم يحتوي على {manifest}.",
  "error.import.skillFolderMissing": "{name}: فولدر المهارة {skill} مفيهوش SKILL.md.",
  "error.import.avatarSkipped": "{name}: الصورة اتخطّت لأنها مش PNG أو JPEG أو WebP أقل من 512 KB.",
  "error.import.exportClosed": "التصدير مبقاش مفتوح. اختاره تاني.",
  "error.import.agentNotInExport": "الاختيار فيه إيجنت مش موجود في التصدير.",
  "error.import.channelNotInExport": "الاختيار فيه قناة مش موجودة في التصدير.",
  "error.import.serverAgentLimit": "السيرفر يقدر يكون فيه {limit} إيجنت على الأكتر.",
  "error.import.exportChanged": "التصدير اتغيّر بعد ما اتفحص. اختاره تاني.",
  "error.import.noMembersImported": "ولا إيجنت من إيجنتاتها اتستورد.",
  "error.import.leadNotImported": "{name}: القائد بتاعها ماتستوردش، فمفيهاش قائد.",
  "error.import.routineSkipped": "{name}: الروتين «{routine}» اتخطّى. {reason}",
  "error.import.fileRenamed": "{name}: {file} موجود بالفعل، فالنسخة دي اتحفظت باسم {saved}.",
  "error.import.fileSkipped": "{name}: الملف {file} اتخطّى. {reason}",
  "error.import.chooseZip": "اختار ملف .zip.",
  "error.import.zipTooLarge": "التصدير لازم يكون ملف .zip أقل من 500 MB.",
  "error.import.unsafeFile": "التصدير فيه ملف مش آمن: {name}",
  "error.import.expandedTooLarge": "التصدير لازم يتفك لأقل من 500 MB و{limit} ملف.",
  "error.import.zipInvalid": "الملف اللي اخترته مش .zip صالح. لو Grok Bot لسه بيحفظه، استنى واختاره تاني.",
  "error.import.empty": "التصدير فاضي.",
  "error.import.remoteZipTooLarge": "علشان تستورد في سيرفر منضم إليه، التصدير لازم يكون .zip أقل من 100 MB.",
  "error.import.hostBusy": "السيرفر بيقرا تصديرات تانية. جرّب تاني بعد كام دقيقة.",
  "error.import.skillKept":
    "{name}: السيرفر عنده المهارة «{skill}» بالفعل، فالإيجنت بيستخدم المهارة دي. اطلب من أدمن يحدّثها.",
  "error.import.hermesNoProfiles":
    "الفولدر ده مفيهوش بروفايلات Hermes. اختار فولدر Hermes، اللي فيه config.yaml أو SOUL.md.",
  "error.import.hermesClosed": "بروفايلات Hermes مبقتش مفتوحة. اقراها تاني.",
  "error.import.hermesProfileMissing": "الاختيار فيه بروفايل Hermes ماتقراش.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md أطول من {limit} حرف، فالتعليمات بتحتفظ بالبداية بتاعته. الملف الكامل في imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": "{name}: المهارة «{skill}» اتخطّت. {reason}",
  "error.import.hermesSkillCodeAdded":
    "فيها كود ماكانش فيها وقت ما البروفايلات اتقرت. اقرا البروفايلات تاني علشان تسمح بيه.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot معرفش يحفظ أنهي إيجنت جه من البروفايل ده، فالاستيراد الجاي هيضيفه كإيجنت جديد.",
  "error.import.transferRemoteTooLarge":
    "ملف النقل لسيرفر منضم إليه لازم يكون أقل من 100 MB. اقفل ملفات مساحة العمل، أو صدّر إيجنتات أقل.",
  "error.import.transferSameServer": "اختار سيرفرين مختلفين. السيرفر ماينفعش ينسخ إعداده لنفسه.",
  "error.import.transferMoveUnsupported":
    "السيرفر ده مش يقدر يأكد النقل. حدّثه، أو انسخ الإعداد بدل ما تنقل وامسح المصدر بنفسك.",
  "error.import.transferMoveInvalid": "مصدر النقل ده مش متاح تاني. ابدأ النقل من الأول.",
  "error.import.transferArchiveInvalid": "الملف ده مش أرشيف عمله الكمبيوتر ده.",
  "error.import.transferLedgerUnreadable": "مقدرناش نقرا سجل النقل على الهدف، فممكن يكرر شوية خطوات سابقة.",
  "error.import.transferLedgerUnwritable":
    "السيرفر ده ماقدرش يسجّل النقل، فالأَسرار بتاعته مش هتوصله. اكتبها تاني من الإعدادات.",
  "error.import.transferSecretsUnsupported":
    "الاتصال ده مش بيقدر يستقبل أَسرار. حدّث OpenBot على السيرفرين، أو اكتبها تاني من الإعدادات.",
  "error.import.transferSecretsStale": "الأَسرار اللي على السيرفر ده اتغيرت. اختارها تاني.",
  "error.import.transferSecretsLedger": "السيرفر ده ماسجّلش النقل، فمش هيقدر يستقبل الأَسرار بتاعته.",
  "error.import.transferSecretKeyInvalid": "السيرفر التاني بعت مفتاح مش صالح، فمفيش سرّ اتبعت.",
  "error.import.transferSecretKeyExpired": "السيرفر التاني مش جاهز للأَسرار خلاص. ابدأ النسخ تاني.",
  "error.import.transferSecretGone": "السرّ ده مش موجود على السيرفر ده خلاص.",
  "error.import.transferSecretUnsupported": "تسجيل الدخول ده لازم يتعمل تاني على السيرفر التاني.",
  "error.import.transferSecretSeal": "السرّ ده ماتشفّرش، فماتبعش.",
  "error.import.transferSecretTooLarge": "الأَسرار اللي اخترتها كبيرة أوي عشان تتبعت. اختار أقل منها.",
  "error.import.transferSecretInvalid": "سرّ ماقدرناش نقراه بأمان، فماتطبّقش.",
  "error.import.transferSecretApply": "السرّ ده ماقدرناش نحفظه على السيرفر التاني.",
  "error.import.transferSecretProviderUnknown": "السيرفر التاني مش عارف المزوّد ده.",
  "error.import.transferSecretCustomProviderMissing":
    "المزوّد المخصص المطابق مش موجود على السيرفر التاني، فالمفتاح ماتضافش.",
  "error.import.transferSecretGithub": "GitHub مارفضش تسجيل الدخول ده على السيرفر التاني. سجّل دخول تاني هناك.",
  "error.import.transferSecretOnePassword": "1Password مارفضش التوكن ده على السيرفر التاني. وصّله تاني هناك.",
  "error.import.transferNotFile": "الملف ده مش ملف نقل من OpenBot.",
  "error.import.transferNewer": "نسخة أحدث من OpenBot عملت الملف ده. حدّث OpenBot وجرّب تاني.",
  "error.import.transferEmpty": "الملف مفيهوش أي إيجنتات ولا إعدادات.",
  "error.import.transferTooLarge":
    "ملف النقل لازم يكون أقل من 2 GB و50,000 ملف. اقفل ملفات مساحة العمل، أو صدّر إيجنتات أقل.",
  "error.import.transferAgentInvalid": "الإيجنت رقم {number} في الملف مش صالح، فاتخطّى.",
  "error.import.transferSettingsInvalid": "إعدادات التطبيق في الملف مش صالحة، فماتستوردتش.",
  "error.import.transferModelMissing":
    "{name}: الموديل «{model}» مش متاح هنا لسه، فالإيجنت بيستخدم الموديل الافتراضي. اختار الموديل تاني لما المزوّد بتاعه يبقى جاهز.",
  "error.import.transferSettingSkipped": "{name} ماتستوردش. {reason}",
  "error.import.transferRoutineFlowSkipped": "الاستيراد سيب مسار روتين. {reason}",
  "error.import.historyFileInvalid": "تاريخ الشات بتاع {name} مش قابل للقراءة، فالمحادثات دي ماتستوردتش.",
  "error.import.historyThreadSkipped": "محادثة من {name} مش سليمة، فماتستوردتش.",
  "error.import.historyMessagesSkipped": "في رسايل في محادثة من {name} مش سليمة، فماتستوردتش.",
  "error.import.historyAttachmentNotCopied": "المرفق {attachment} ماتنسخش، فالرسالة اتستوردت من غيره.",
  "error.import.transferCustomAgentCommand":
    "{name}: الإيجنتات المخصصة ماتستوردتش، لأنها بتشغّل أمر. راجع الأمر «{command}» وضيف الإيجنت تاني من الإعدادات.",
  "error.import.transferSkillLimit":
    "{name}: أول {limit} مهارة بس من {total} مهارة هما اللي في الملف، لأن الإيجنت يقدر يكون عنده {limit} مهارة.",
  "error.import.transferFilesGone": "{number} ملف اتمسحوا وقت التصدير، فمش موجودين في الملف.",
  "error.import.transferProviderKey": "{name}: اكتب مفتاح API بتاعه تاني في الإعدادات.",
  "error.import.transferAgentEnv": "{name}: اكتب قيم {names} تاني في الإعدادات.",
  "error.import.transferMcpValues":
    "{name}: سيرفر MCP اتضاف وهو مقفول. راجع الأمر بتاعه، واكتب قيمه وعنوانه الكامل تاني، وشغّله من إعدادات MCP.",
  "error.import.transferValuesCleared":
    "{name}: القيم اللي ممكن تحتوي على سرّ اتشالت من الـ arguments أو العنوان بتاعه. اكتبها تاني في الإعدادات.",
  "error.import.transferSharedKept": "{number} ملف في فولدر Shared موجودين هنا بالفعل، فاتساب زي ما هما.",
} as const satisfies PartialTranslation<typeof source>;
