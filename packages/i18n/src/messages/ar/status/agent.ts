import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside": "اكتب في {path}، برّه مساحة عمل الإيجنت والفولدر المشترك والفولدرات المؤقتة.",
  "status.agent.contextCleared": "السياق اتمسح. شات جديد بيبدأ من هنا.",
  "status.agent.modelSwitchedForLimit": "حد الاستخدام خلص. اتحوّل لـ {model}.",
  "status.agent.modelReturnedAfterLimit": "حد الاستخدام انتهى. رجع تاني لـ {model}.",
  "status.agent.modelSwitchedForError": "خطأ من المزوّد. اتحوّل لـ {model}.",
  "status.agent.modelReturnedAfterError": "رجع تاني لـ {model} بعد خطأ المزوّد.",
  "status.agent.marketplaceSuggested": "اقترح تطبيق من السوق: {app}.",
  "status.agent.channelMemberAdded": "{agent} ضاف {member} للقناة. {person} طلب ده.",
  "status.agent.channelMemberRemoved": "{agent} شال {member} من القناة. {person} طلب ده.",
  "status.agent.channelInstructionsChanged": "{agent} غيّر تعليمات القناة. {person} طلب ده.",
  "status.agent.channelRoutineCreated": "{agent} عمل الروتين {routine}. {person} طلب ده.",
  "status.agent.channelRoutineUpdated": "{agent} غيّر الروتين {routine}. {person} طلب ده.",
  "status.agent.channelRoutineDeleted": "{agent} مسح الروتين {routine}. {person} طلب ده.",
  "status.agent.screenCaptureScreen": "التقاط الشاشة الرئيسية وإرسال الصورة لموديل الإيجنت.",
  "status.agent.screenCaptureChannel":
    "الصورة هتظهر في القناة {channel}، وكل عضو في السيرفر ده بيقرا القناة هيقدر يشوفها.",
  "status.agent.screenCaptureDisplay": "التقاط الشاشة {name} وإرسال الصورة لموديل الإيجنت.",
  "status.agent.screenCaptureWindow": "التقاط النافذة {name} وإرسال الصورة لموديل الإيجنت.",
  "status.agent.screenCaptureRegion":
    "التقاط منطقة الشاشة عند {x}, {y}, {width} × {height} نقطة وإرسال الصورة لموديل الإيجنت.",
  "status.agent.vaultCardFill":
    "ملء الكارت المحفوظ {card} على {site}. بعد ما توافق، الإيجنتات هتقدر تملا الكارت ده على الموقع ده من غير موافقة. شيل الموقع من إعدادات السيرفر > Vault.",
  "status.agent.vaultCardFillFrames": "خانات الكارت جوه frames من {origins}.",
  "status.agent.screenCaptureProgress": "بيطلب التقاط الشاشة…",
  "status.agent.screenCaptureReviewing": "بيراجع لقطة الشاشة…",
  "status.agent.memoriesSearching": "بيدوّر في ذكرياته…",
  "status.agent.memoriesSearched": {
    one: "دوّر في ذكرياته: لقى {count}",
    other: "دوّر في ذكرياته: لقى {count}",
  },
  "status.agent.memoriesUpdating": "بيحدّث ذكرياته…",
  "status.agent.skillUsing": "بيستخدم المهارة {name}…",
  "status.agent.skillReading": "بيقرا مهارة…",
  "status.agent.memoryChanges": "الذاكرة: {saved} اتحفظ، {updated} اتحدّث، {forgotten} اتنسي.",
  "status.agent.mcpServerAdd":
    "إضافة سيرفر MCP {name}: {target}. كل إيجنت على السيرفر ده هياخد أدواته. OpenBot هيتصل بيه علشان يختبره.",
  "status.agent.mcpServerChange":
    "تغيير سيرفر MCP {name} لـ {target}. كل إيجنت على السيرفر ده هياخد أدواته. OpenBot هيتصل بيه علشان يختبره.",
  "status.agent.mcpServerEnable": "تشغيل سيرفر MCP {name} لكل إيجنت على السيرفر ده.",
  "status.agent.mcpServerDisable": "إيقاف سيرفر MCP {name} لكل إيجنت على السيرفر ده.",
  "status.agent.mcpServerRemove": "مسح سيرفر MCP {name} وتسجيل الدخول بتاعه من كل إيجنت على السيرفر ده.",
  "status.agent.mcpSignInRequested": "سيرفر MCP {name} محتاج تسجيل دخول. سجّل دخول من إعدادات السيرفر، MCP.",
  "status.agent.vaultAdded": "اتحفظ في Vault: {name}",
  "status.agent.vaultUpdated": "اتغيّر في Vault: {name}",
  "status.agent.vaultDeleted": "اتمسح من Vault: {name}",
} as const satisfies PartialTranslation<typeof source>;
